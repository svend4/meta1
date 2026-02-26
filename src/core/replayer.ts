import { randomUUID } from 'node:crypto';
import type { RunSummary } from '../types/run-summary.js';
import type { DriftVector } from '../types/drift-vector.js';
import type { AssertionResult } from '../types/assertion.js';
import type { PlanLineage } from '../types/plan-lineage.js';
import type { Sandbox } from '../sandbox/types.js';
import { isPlanV3 } from '../types/execution-plan.js';
import type { ExecutionPlanV3 } from '../types/execution-plan.js';
import { EventLogger, createEvent } from './logger.js';
import { executePlan } from './executor.js';
import { executeAssertions } from './asserter.js';
import { hashObject, computeRunHash } from './hasher.js';
import { loadRunSummary } from '../storage/runs.js';
import { saveRunSummary } from '../storage/runs.js';
import { captureDependencyFingerprint, compareDependencyFingerprints } from './fingerprint.js';
import {
  detectEnvironmentDrift,
  detectDependencyDrift,
  detectArtifactDrift,
  detectAssertionDrift,
  classifyDrifts,
} from './drift-detector.js';
import {
  createBenignDriftGeneration,
  saveGeneration,
} from './lineage.js';
import { executeCascade } from './repair-cascade.js';

/** v2.1 compatible divergence info */
export interface Divergence {
  stepId: string;
  expectedHash: `sha256:${string}`;
  actualHash: `sha256:${string}`;
}

/** v3.0 replay verdict */
export type ReplayVerdict =
  | 'identical'
  | 'benign_drift'
  | 'drifted'
  | 'healed'
  | 'repair_failed';

export interface ReplayResult {
  summary: RunSummary;
  verified: boolean;
  divergences: Divergence[];
  checksPassed: number;
  checksTotal: number;
  // v3.0 fields
  verdict?: ReplayVerdict;
  driftVectors?: DriftVector[];
  assertionResults?: AssertionResult[];
  newGeneration?: {
    planHash: `sha256:${string}`;
    lineage: PlanLineage;
  };
}

export interface ReplayOptions {
  heal?: boolean;
  forensics?: boolean;
  apiKey?: string;
}

/**
 * Replay a previous run: re-execute its plan and compare artifact hashes.
 * This is THE CORE of Continuum — proving determinism by repetition.
 *
 * v2.1 behavior: For each step with determinism "guaranteed", hash must match.
 * v3.0 extension: Full Integrity/Correctness matrix, benign drift, cascade.
 */
export async function replay(
  originalRunId: string,
  sandbox: Sandbox,
  workspace: string,
  options?: ReplayOptions,
): Promise<ReplayResult> {
  const original = loadRunSummary(originalRunId);
  const replayRunId = randomUUID();
  const logger = new EventLogger(replayRunId);
  const startedAt = new Date();

  logger.log(createEvent('replay_start', replayRunId, {
    original_run_id: originalRunId,
  }));

  try {
    await sandbox.init();

    // v3.0: Capture and compare fingerprints
    const currentFingerprint = captureDependencyFingerprint(workspace);
    logger.log(createEvent('fingerprint_captured', replayRunId, {
      fingerprint_hash: currentFingerprint.fingerprint_hash,
      tools: currentFingerprint.tools as Record<string, string>,
      lockfile_hash: currentFingerprint.lockfile?.hash,
      image_digest: currentFingerprint.sandbox_image?.digest,
    }));

    const originalFingerprint = original.dependency_fingerprint;
    if (originalFingerprint) {
      const fpDrifts = compareDependencyFingerprints(originalFingerprint, currentFingerprint);
      logger.log(createEvent('fingerprint_compared', replayRunId, {
        match: fpDrifts.length === 0,
        drifts: fpDrifts,
      }));
    }

    // Re-execute the same plan
    const { steps: replaySteps, artifactHashes } = await executePlan(
      original.plan,
      sandbox,
      logger,
      replayRunId,
    );

    // ── v2.1 compatibility: Compare artifact hashes step-by-step ──
    const divergences: Divergence[] = [];
    let checksPassed = 0;
    let checksTotal = 0;

    for (const replayStep of replaySteps) {
      if (replayStep.status !== 'completed' || !replayStep.artifact_hash) continue;

      const originalStep = original.steps.find(
        (s) => s.step_id === replayStep.step_id,
      );
      if (!originalStep?.artifact_hash) continue;

      const planStep = original.plan.steps.find(
        (s) => s.step_id === replayStep.step_id,
      );

      checksTotal++;

      if (replayStep.artifact_hash === originalStep.artifact_hash) {
        checksPassed++;
      } else {
        const div: Divergence = {
          stepId: replayStep.step_id,
          expectedHash: originalStep.artifact_hash,
          actualHash: replayStep.artifact_hash,
        };
        divergences.push(div);

        logger.log(createEvent('replay_diverged', replayRunId, {
          original_run_id: originalRunId,
          step_id: replayStep.step_id,
          expected_hash: originalStep.artifact_hash,
          actual_hash: replayStep.artifact_hash,
        }));

        // Only count guaranteed-determinism divergences as true failures
        if (planStep?.determinism === 'guaranteed') {
          // Guaranteed step diverged — this is a real problem
        } else {
          // best_effort divergence is noted but doesn't break verification
          checksPassed++;
        }
      }
    }

    // v2.1 verification: guaranteed steps match
    const guaranteedDivergences = divergences.filter((d) => {
      const planStep = original.plan.steps.find((s) => s.step_id === d.stepId);
      return planStep?.determinism === 'guaranteed';
    });
    const verified = guaranteedDivergences.length === 0;

    // ── v3.0: Full Integrity/Correctness matrix ──
    let verdict: ReplayVerdict = verified ? 'identical' : 'drifted';
    let allDriftVectors: DriftVector[] = [];
    let assertionResults: AssertionResult[] | undefined;
    let newGeneration: ReplayResult['newGeneration'] | undefined;

    const isV3 = isPlanV3(original.plan);

    if (isV3) {
      const v3Plan = original.plan as ExecutionPlanV3;

      // Run assertions
      let allRequiredPassed = true;
      if (v3Plan.assertions && v3Plan.assertions.length > 0) {
        const assertResult = await executeAssertions(
          v3Plan.assertions,
          sandbox,
          logger,
          replayRunId,
        );
        assertionResults = assertResult.results;
        allRequiredPassed = assertResult.allRequiredPassed;
      }

      // Detect all drift vectors
      if (originalFingerprint) {
        const envDrifts = detectEnvironmentDrift(originalFingerprint, currentFingerprint, replayRunId, originalRunId);
        const depDrifts = detectDependencyDrift(originalFingerprint, currentFingerprint, replayRunId, originalRunId);
        allDriftVectors.push(...envDrifts, ...depDrifts);
      }

      const artifactDrifts = detectArtifactDrift(
        original.steps,
        replaySteps,
        original.plan.steps,
        v3Plan.protected_surface,
        replayRunId,
        originalRunId,
      );
      allDriftVectors.push(...artifactDrifts);

      const failedAssertionResults = (assertionResults ?? []).filter((r) => !r.passed);
      const assertionDrifts = failedAssertionResults.length > 0
        ? detectAssertionDrift(failedAssertionResults, replayRunId, originalRunId)
        : [];
      allDriftVectors.push(...assertionDrifts);

      // Log drift vectors
      for (const d of allDriftVectors) {
        logger.log(createEvent('drift_detected', replayRunId, {
          drift_id: d.drift_id,
          category: d.category,
          severity: d.severity,
          repairable: d.repairable,
          repair_level: d.repair_level,
        }));
      }

      // Classify drifts using the Integrity/Correctness matrix
      const classification = classifyDrifts(artifactDrifts, assertionDrifts, allRequiredPassed);
      verdict = classification.verdict;

      // Handle benign drift → create new generation
      if (verdict === 'benign_drift') {
        const parentPlanHash = hashObject(original.plan);
        const parentGeneration = v3Plan.lineage?.generation ?? 0;

        const changedArtifacts = divergences.map((d) => ({
          path: d.stepId,
          old_hash: d.expectedHash,
          new_hash: d.actualHash,
        }));

        const lineage = createBenignDriftGeneration(parentPlanHash, parentGeneration, changedArtifacts);
        const newPlanHash = saveGeneration(original.plan, lineage, assertionResults, replayRunId);

        newGeneration = { planHash: newPlanHash, lineage };

        logger.log(createEvent('drift_benign', replayRunId, {
          drift_id: randomUUID(),
          changed_artifacts: changedArtifacts.map((a) => a.path),
          assertions_passed: true,
        }));

        logger.log(createEvent('generation_created', replayRunId, {
          plan_hash: newPlanHash,
          parent_hash: parentPlanHash,
          generation: lineage.generation,
          mutation_type: 'benign_drift_accepted',
        }));
      }

      // Handle drifted + --heal → run Repair Cascade
      if (verdict === 'drifted' && options?.heal) {
        const parentPlanHash = hashObject(original.plan);
        const parentGeneration = v3Plan.lineage?.generation ?? 0;

        const cascadeResult = await executeCascade(
          original.plan,
          v3Plan.assertions ?? [],
          allDriftVectors,
          failedAssertionResults,
          originalFingerprint,
          currentFingerprint,
          sandbox,
          logger,
          replayRunId,
          originalRunId,
          parentPlanHash,
          parentGeneration,
          { apiKey: options.apiKey },
        );

        if (cascadeResult.resolved) {
          verdict = 'healed';
          if (cascadeResult.lineage) {
            const healedPlan = cascadeResult.repairedPlan ?? original.plan;
            const newPlanHash = saveGeneration(healedPlan, cascadeResult.lineage, cascadeResult.assertionResults, replayRunId);
            newGeneration = { planHash: newPlanHash, lineage: cascadeResult.lineage };

            logger.log(createEvent('generation_created', replayRunId, {
              plan_hash: newPlanHash,
              parent_hash: parentPlanHash,
              generation: cascadeResult.lineage.generation,
              mutation_type: cascadeResult.lineage.mutation_type,
            }));
          }
          if (cascadeResult.assertionResults) {
            assertionResults = cascadeResult.assertionResults;
          }
        } else {
          verdict = 'repair_failed';
        }
      }
    }

    logger.log(createEvent('replay_verified', replayRunId, {
      original_run_id: originalRunId,
      checks_passed: checksPassed,
      checks_total: checksTotal,
    }));

    const planHash = hashObject(original.plan);
    const runHash = computeRunHash(artifactHashes);
    const duration = Date.now() - startedAt.getTime();

    const failedStep = replaySteps.find((s) => s.status === 'failed');

    if (failedStep) {
      logger.log(createEvent('run_failed', replayRunId, {
        error: failedStep.error ?? 'Step execution failed during replay',
        failed_step_id: failedStep.step_id,
      }));
    } else {
      logger.log(createEvent('run_complete', replayRunId, {
        duration_ms: duration,
        plan_hash: planHash,
        run_hash: runHash,
      }));
    }

    // Map verdict to summary status
    let summaryStatus: RunSummary['status'];
    if (failedStep) {
      summaryStatus = 'failed';
    } else if (isV3) {
      switch (verdict) {
        case 'identical': summaryStatus = 'verified'; break;
        case 'benign_drift': summaryStatus = 'benign_drift'; break;
        case 'healed': summaryStatus = 'healed'; break;
        case 'drifted':
        case 'repair_failed': summaryStatus = 'assertion_failed'; break;
        default: summaryStatus = 'completed';
      }
    } else {
      summaryStatus = failedStep ? 'failed' : 'completed';
    }

    const summary: RunSummary = {
      run_id: replayRunId,
      task_id: original.task_id,
      prompt: original.prompt,
      status: summaryStatus,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      plan: original.plan,
      plan_hash: planHash,
      plan_source: original.plan_source,
      run_hash: failedStep ? undefined : runHash,
      steps: replaySteps,
      workspace,
      assertions_passed: assertionResults?.filter((r) => r.passed).length,
      assertions_total: assertionResults?.length,
      assertion_results: assertionResults,
      dependency_fingerprint: currentFingerprint,
    };

    saveRunSummary(summary);

    return {
      summary,
      verified,
      divergences,
      checksPassed,
      checksTotal,
      verdict,
      driftVectors: allDriftVectors.length > 0 ? allDriftVectors : undefined,
      assertionResults,
      newGeneration,
    };
  } finally {
    await sandbox.destroy();
  }
}
