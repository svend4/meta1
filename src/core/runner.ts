import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ExecutionPlan } from '../types/execution-plan.js';
import { isPlanV3 } from '../types/execution-plan.js';
import type { TaskSpec } from '../types/task-spec.js';
import type { RunSummary } from '../types/run-summary.js';
import type { Sandbox } from '../sandbox/types.js';
import { EventLogger, createEvent } from './logger.js';
import { hashObject, computeRunHash } from './hasher.js';
import { lookupPlan, storePlan } from './plan-cache.js';
import { generatePlan, SYSTEM_PROMPT_HASH } from './planner.js';
import { assertValidPlan } from './validator.js';
import { executePlan } from './executor.js';
import { executeAssertions } from './asserter.js';
import { captureDependencyFingerprint } from './fingerprint.js';
import { createOriginalLineage, saveGeneration } from './lineage.js';
import { saveRunSummary } from '../storage/runs.js';

export interface RunOptions {
  workspace: string;
  apiKey?: string;
  useCache?: boolean;
  cacheOnly?: boolean;
}

export type PlanSource = 'llm' | 'cache' | 'file';

/**
 * Full pipeline: task → cache check → plan → execute → assert → log → summary.
 * This is the core orchestration function for `continuum run`.
 * v3.0: Now includes assertions, fingerprinting, and lineage.
 */
export async function run(
  task: TaskSpec,
  sandbox: Sandbox,
  options: RunOptions,
): Promise<RunSummary> {
  const runId = randomUUID();
  const logger = new EventLogger(runId);
  const startedAt = new Date();

  logger.log(createEvent('run_start', runId, {
    task_id: task.task_id,
    prompt: task.prompt,
    model: task.model,
  }));

  let plan: ExecutionPlan;
  let planSource: PlanSource;
  let cacheKey: `sha256:${string}` | undefined;

  try {
    // Step 1: Acquire plan (cache → LLM → fail)
    const acquired = await acquirePlan(task, logger, runId, options);
    plan = acquired.plan;
    planSource = acquired.source;
    cacheKey = acquired.cacheKey;

    // Step 2: Initialize sandbox
    await sandbox.init();

    // Step 2.5: Capture dependency fingerprint
    const fingerprint = captureDependencyFingerprint(options.workspace);
    logger.log(createEvent('fingerprint_captured', runId, {
      fingerprint_hash: fingerprint.fingerprint_hash,
      tools: fingerprint.tools as Record<string, string>,
      lockfile_hash: fingerprint.lockfile?.hash,
      image_digest: fingerprint.sandbox_image?.digest,
    }));

    // Step 3: Execute all steps
    const { steps, artifactHashes } = await executePlan(plan, sandbox, logger, runId);

    // Step 4: Compute hashes
    const planHash = hashObject(plan);
    const runHash = computeRunHash(artifactHashes);
    const duration = Date.now() - startedAt.getTime();

    // Check if any step failed
    const failedStep = steps.find((s) => s.status === 'failed');

    if (failedStep) {
      logger.log(createEvent('run_failed', runId, {
        error: failedStep.error ?? 'Step execution failed',
        failed_step_id: failedStep.step_id,
      }));

      const summary: RunSummary = {
        run_id: runId,
        task_id: task.task_id,
        prompt: task.prompt,
        status: 'failed',
        started_at: startedAt.toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        plan,
        plan_hash: planHash,
        plan_source: planSource,
        cache_key: cacheKey,
        steps,
        workspace: options.workspace,
        dependency_fingerprint: fingerprint,
      };

      saveRunSummary(summary);
      return summary;
    }

    // Step 5: Run assertions (v3.0)
    let assertionsPassed: number | undefined;
    let assertionsTotal: number | undefined;
    let assertionResults: RunSummary['assertion_results'];
    let status: RunSummary['status'] = 'completed';

    if (isPlanV3(plan) && plan.assertions && plan.assertions.length > 0) {
      const assertResult = await executeAssertions(plan.assertions, sandbox, logger, runId);
      assertionsPassed = assertResult.passed;
      assertionsTotal = assertResult.total;
      assertionResults = assertResult.results;
      status = assertResult.allRequiredPassed ? 'verified' : 'assertion_failed';
    }

    // Step 6: Log completion
    logger.log(createEvent('run_complete', runId, {
      duration_ms: duration,
      plan_hash: planHash,
      run_hash: runHash,
    }));

    // Step 7: Save lineage for v3.0 plans
    if (isPlanV3(plan)) {
      const lineage = createOriginalLineage();
      plan.lineage = lineage;
      saveGeneration(plan, lineage, assertionResults, runId);

      logger.log(createEvent('generation_created', runId, {
        plan_hash: planHash,
        generation: 0,
        mutation_type: 'original',
      }));
    }

    const summary: RunSummary = {
      run_id: runId,
      task_id: task.task_id,
      prompt: task.prompt,
      status,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      plan,
      plan_hash: planHash,
      plan_source: planSource,
      cache_key: cacheKey,
      run_hash: runHash,
      steps,
      workspace: options.workspace,
      assertions_passed: assertionsPassed,
      assertions_total: assertionsTotal,
      assertion_results: assertionResults,
      dependency_fingerprint: fingerprint,
    };

    saveRunSummary(summary);
    return summary;
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    logger.log(createEvent('run_failed', runId, { error }));

    throw err;
  } finally {
    await sandbox.destroy();
  }
}

/**
 * Execute an existing plan file without LLM involvement.
 * This is the core function for `continuum execute`.
 */
export async function executeFromFile(
  planPath: string,
  sandbox: Sandbox,
  options: RunOptions,
): Promise<RunSummary> {
  const raw = JSON.parse(readFileSync(planPath, 'utf8'));
  assertValidPlan(raw);
  const plan = raw as ExecutionPlan;

  const runId = randomUUID();
  const logger = new EventLogger(runId);
  const startedAt = new Date();

  logger.log(createEvent('plan_loaded', runId, {
    source: 'file',
    path: planPath,
  }));

  try {
    await sandbox.init();

    // Capture fingerprint
    const fingerprint = captureDependencyFingerprint(options.workspace);
    logger.log(createEvent('fingerprint_captured', runId, {
      fingerprint_hash: fingerprint.fingerprint_hash,
      tools: fingerprint.tools as Record<string, string>,
      lockfile_hash: fingerprint.lockfile?.hash,
      image_digest: fingerprint.sandbox_image?.digest,
    }));

    const { steps, artifactHashes } = await executePlan(plan, sandbox, logger, runId);
    const planHash = hashObject(plan);
    const runHash = computeRunHash(artifactHashes);
    const duration = Date.now() - startedAt.getTime();

    const failedStep = steps.find((s) => s.status === 'failed');

    if (failedStep) {
      logger.log(createEvent('run_failed', runId, {
        error: failedStep.error ?? 'Step execution failed',
        failed_step_id: failedStep.step_id,
      }));
    } else {
      logger.log(createEvent('run_complete', runId, {
        duration_ms: duration,
        plan_hash: planHash,
        run_hash: runHash,
      }));
    }

    // Run assertions for v3.0 plans
    let assertionsPassed: number | undefined;
    let assertionsTotal: number | undefined;
    let assertionResults: RunSummary['assertion_results'];
    let status: RunSummary['status'] = failedStep ? 'failed' : 'completed';

    if (!failedStep && isPlanV3(plan) && plan.assertions && plan.assertions.length > 0) {
      const assertResult = await executeAssertions(plan.assertions, sandbox, logger, runId);
      assertionsPassed = assertResult.passed;
      assertionsTotal = assertResult.total;
      assertionResults = assertResult.results;
      status = assertResult.allRequiredPassed ? 'verified' : 'assertion_failed';
    }

    const summary: RunSummary = {
      run_id: runId,
      task_id: 'manual',
      prompt: plan.description ?? planPath,
      status,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      plan,
      plan_hash: planHash,
      plan_source: 'file',
      run_hash: failedStep ? undefined : runHash,
      steps,
      workspace: options.workspace,
      assertions_passed: assertionsPassed,
      assertions_total: assertionsTotal,
      assertion_results: assertionResults,
      dependency_fingerprint: fingerprint,
    };

    saveRunSummary(summary);
    return summary;
  } finally {
    await sandbox.destroy();
  }
}

interface AcquiredPlan {
  plan: ExecutionPlan;
  source: PlanSource;
  cacheKey?: `sha256:${string}`;
}

async function acquirePlan(
  task: TaskSpec,
  logger: EventLogger,
  runId: string,
  options: RunOptions,
): Promise<AcquiredPlan> {
  const cacheParams = {
    prompt: task.prompt,
    context: task.context,
    model: task.model,
    systemPromptHash: SYSTEM_PROMPT_HASH,
  };

  const useCache = options.useCache !== false;

  // Try cache first
  if (useCache) {
    const cached = lookupPlan(cacheParams);

    if (cached.hit) {
      logger.log(createEvent('plan_cache_hit', runId, {
        cache_key: cached.cacheKey,
        plan_hash: cached.planHash,
      }));
      return { plan: cached.plan, source: 'cache', cacheKey: cached.cacheKey };
    }

    logger.log(createEvent('plan_cache_miss', runId, {
      cache_key: cached.cacheKey,
      reason: cached.reason,
    }));

    if (options.cacheOnly) {
      throw new Error(
        `No cached plan found (cache key: ${cached.cacheKey}). Use --no-cache to generate a new plan.`,
      );
    }
  }

  // Generate via LLM
  const plan = await generatePlan(task, { apiKey: options.apiKey });
  const planHash = hashObject(plan);

  logger.log(createEvent('plan_generated', runId, {
    plan_hash: planHash,
    step_count: plan.steps.length,
  }));

  // Store in cache
  if (useCache) {
    const cacheKey = storePlan(plan, cacheParams);
    return { plan, source: 'llm', cacheKey };
  }

  return { plan, source: 'llm' };
}
