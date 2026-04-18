import type { Assertion, AssertionResult } from '../types/assertion.js';
import type { DriftVector } from '../types/drift-vector.js';
import type { DependencyFingerprint } from '../types/dependency-fingerprint.js';
import type { ExecutionPlan, ExecutionPlanV3 } from '../types/execution-plan.js';
import type { PlanLineage } from '../types/plan-lineage.js';
import type { Sandbox } from '../sandbox/types.js';
import type { EventLogger } from './logger.js';
import { createEvent } from './logger.js';
import { hashObject } from './hasher.js';
import { retryFlakyAssertions } from './repair-retry.js';
import { findMatchingStrategies, executeRepairAction } from './repair-strategies.js';
import { repairWithLLM } from './repair-compiler.js';
import { executeAssertions } from './asserter.js';
import { executePlan } from './executor.js';
import {
  createDeterministicRepairGeneration,
  createLLMRepairGeneration,
} from './lineage.js';

export interface CascadeResult {
  resolved: boolean;
  level: 0 | 1 | 2 | 3 | 4;
  repairedPlan?: ExecutionPlanV3;
  lineage?: PlanLineage;
  assertionResults?: AssertionResult[];
  unresolvedDrifts?: DriftVector[];
  error?: string;
}

/**
 * Execute the full Repair Cascade: L1 → L2 → L3 → L4.
 * Cheapest first, LLM last.
 */
export async function executeCascade(
  plan: ExecutionPlan,
  assertions: Assertion[],
  driftVectors: DriftVector[],
  failedAssertions: AssertionResult[],
  originalFingerprint: DependencyFingerprint | undefined,
  currentFingerprint: DependencyFingerprint | undefined,
  sandbox: Sandbox,
  logger: EventLogger,
  runId: string,
  sourceRunId: string,
  parentPlanHash: `sha256:${string}`,
  parentGeneration: number,
  options?: { apiKey?: string },
): Promise<CascadeResult> {
  logger.log(createEvent('cascade_started', runId, {
    drift_vectors: driftVectors.map((d) => d.drift_id),
    total_levels: 4,
  }));

  let remainingDrifts = [...driftVectors];
  let currentAssertionResults = [...failedAssertions];

  // ─── Level 1: Retry flaky/environmental assertions ───
  logger.log(createEvent('cascade_level_started', runId, { level: 1, strategy: 'retry' }));
  const l1Start = Date.now();

  try {
    const l1Result = await retryFlakyAssertions(
      assertions,
      currentAssertionResults,
      remainingDrifts,
      sandbox,
      logger,
      runId,
    );

    remainingDrifts = l1Result.remaining;
    currentAssertionResults = l1Result.updatedResults;

    if (remainingDrifts.length === 0) {
      logger.log(createEvent('cascade_level_passed', runId, {
        level: 1,
        duration_ms: Date.now() - l1Start,
        result: `Resolved ${l1Result.resolved.length} drift(s) via retry`,
      }));
      return { resolved: true, level: 1, assertionResults: currentAssertionResults };
    }

    logger.log(createEvent('cascade_level_failed', runId, {
      level: 1,
      reason: `${remainingDrifts.length} drift(s) remain after retry`,
    }));
  } catch (err: unknown) {
    logger.log(createEvent('cascade_level_failed', runId, {
      level: 1,
      reason: err instanceof Error ? err.message : String(err),
    }));
  }

  // ─── Level 2: Deterministic repair strategies ───
  logger.log(createEvent('cascade_level_started', runId, { level: 2, strategy: 'deterministic' }));
  const l2Start = Date.now();

  try {
    const resolvedByL2: DriftVector[] = [];

    for (const drift of remainingDrifts) {
      const strategies = findMatchingStrategies(drift);
      for (const strategy of strategies) {
        const actions = strategy.repair(drift, { workspace: sandbox.getWorkspacePath(), source_run_id: sourceRunId });
        let allSucceeded = true;

        for (const action of actions) {
          const result = await executeRepairAction(action, sandbox);
          if (!result.success) {
            allSucceeded = false;
            break;
          }
        }

        if (allSucceeded) {
          resolvedByL2.push(drift);
          break;
        }
      }
    }

    if (resolvedByL2.length > 0) {
      remainingDrifts = remainingDrifts.filter(
        (d) => !resolvedByL2.some((r) => r.drift_id === d.drift_id),
      );

      // Re-run assertions after deterministic repair
      if (assertions.length > 0) {
        const recheck = await executeAssertions(assertions, sandbox, logger, runId);
        currentAssertionResults = recheck.results;

        if (recheck.allRequiredPassed && remainingDrifts.length === 0) {
          const strategyIds = [...new Set(resolvedByL2.flatMap((d) =>
            findMatchingStrategies(d).map((s) => s.id),
          ))];

          const lineage = createDeterministicRepairGeneration(
            parentPlanHash,
            parentGeneration,
            strategyIds.join('+'),
            resolvedByL2.map((d) => d.drift_id),
          );

          logger.log(createEvent('cascade_level_passed', runId, {
            level: 2,
            duration_ms: Date.now() - l2Start,
            result: `Resolved ${resolvedByL2.length} drift(s) via deterministic repair`,
          }));

          return {
            resolved: true,
            level: 2,
            lineage,
            assertionResults: recheck.results,
          };
        }
      }
    }

    logger.log(createEvent('cascade_level_failed', runId, {
      level: 2,
      reason: `${remainingDrifts.length} drift(s) remain after deterministic repair`,
    }));
  } catch (err: unknown) {
    logger.log(createEvent('cascade_level_failed', runId, {
      level: 2,
      reason: err instanceof Error ? err.message : String(err),
    }));
  }

  // ─── Level 3: LLM Repair Compiler (one attempt, constrained) ───
  if (remainingDrifts.length > 0) {
    logger.log(createEvent('cascade_level_started', runId, { level: 3, strategy: 'llm-repair' }));
    const l3Start = Date.now();

    try {
      const repairResult = await repairWithLLM(
        plan,
        remainingDrifts,
        currentAssertionResults.filter((r) => !r.passed),
        originalFingerprint,
        currentFingerprint,
        logger,
        runId,
        options,
      );

      if (repairResult) {
        // Re-execute repaired plan in clean context
        await executePlan(repairResult.repaired_plan, sandbox, logger, runId);

        // Re-run assertions
        const v3Plan = repairResult.repaired_plan as ExecutionPlanV3;
        const planAssertions = v3Plan.assertions ?? assertions;

        if (planAssertions.length > 0) {
          const recheck = await executeAssertions(planAssertions, sandbox, logger, runId);

          if (recheck.allRequiredPassed) {
            const lineage = createLLMRepairGeneration(
              parentPlanHash,
              parentGeneration,
              remainingDrifts.map((d) => d.drift_id),
              hashObject(repairResult),
              repairResult.repair_signature,
              repairResult.mutations_applied,
            );

            logger.log(createEvent('cascade_level_passed', runId, {
              level: 3,
              duration_ms: Date.now() - l3Start,
              result: `LLM repair: ${repairResult.mutations_applied.length} mutation(s)`,
            }));

            return {
              resolved: true,
              level: 3,
              repairedPlan: repairResult.repaired_plan as ExecutionPlanV3,
              lineage,
              assertionResults: recheck.results,
            };
          }
        }
      }

      logger.log(createEvent('cascade_level_failed', runId, {
        level: 3,
        reason: 'LLM repair failed or assertions still failing',
      }));
    } catch (err: unknown) {
      logger.log(createEvent('cascade_level_failed', runId, {
        level: 3,
        reason: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  // ─── Level 4: Unrecoverable ───
  logger.log(createEvent('cascade_level_started', runId, { level: 4 }));
  logger.log(createEvent('cascade_level_failed', runId, {
    level: 4,
    reason: `${remainingDrifts.length} unresolvable drift(s)`,
  }));

  return {
    resolved: false,
    level: 4,
    unresolvedDrifts: remainingDrifts,
    error: formatUnrecoverableReport(remainingDrifts),
  };
}

/** Format an actionable error report for unrecoverable drifts */
function formatUnrecoverableReport(drifts: DriftVector[]): string {
  const lines: string[] = [
    `UNRECOVERABLE — ${drifts.length} drift vector(s) could not be resolved`,
    '',
  ];

  for (let i = 0; i < drifts.length; i++) {
    const d = drifts[i];
    lines.push(`  ${i + 1}. ${d.category.toUpperCase()}: ${d.details.expected} → ${d.details.actual}`);

    switch (d.category) {
      case 'environment':
        lines.push(`     → Manual action: rebuild sandbox image or update plan for compatibility`);
        break;
      case 'artifact_protected':
        lines.push(`     → Source file was modified outside Continuum`);
        lines.push(`     → Manual action: review changes and create new plan`);
        break;
      case 'assertion_stable':
        lines.push(`     → Stable assertion failed — likely a real bug`);
        lines.push(`     → Manual action: debug and fix the underlying issue`);
        break;
      default:
        lines.push(`     → Manual action: investigate and resolve the ${d.category} issue`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
