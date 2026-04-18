import type { ExecutionPlan, Step, CreateFileStep, RunCommandStep } from '../types/execution-plan.js';
import type { StepResult } from '../types/run-summary.js';
import type { Sandbox } from '../sandbox/types.js';
import { EventLogger, createEvent } from './logger.js';
import { hashString } from './hasher.js';
import { evaluateCondition } from './condition.js';
import type { ConditionContext } from './condition.js';

export interface ExecutionResult {
  steps: StepResult[];
  artifactHashes: `sha256:${string}`[];
}

/** Lifecycle hooks called during plan execution */
export interface ExecutionHooks {
  onStepStart?: (step: Step, index: number) => void | Promise<void>;
  onStepComplete?: (step: Step, result: StepResult) => void | Promise<void>;
  onStepFailed?: (step: Step, error: string) => void | Promise<void>;
}

/** Progress event emitted during execution */
export interface ProgressEvent {
  type: 'step_start' | 'step_complete' | 'step_failed' | 'step_skipped';
  stepId: string;
  stepIndex: number;
  totalSteps: number;
  completedSteps: number;
  durationMs?: number;
  error?: string;
}

export interface ExecutionOptions {
  /** Maximum number of steps to run concurrently in parallel mode. Default: Infinity (no limit). */
  maxConcurrency?: number;
  /** Default timeout for steps that don't specify their own timeout_ms. */
  defaultTimeoutMs?: number;
  /** Lifecycle hooks for step events. */
  hooks?: ExecutionHooks;
  /** Progress callback invoked for each step lifecycle event. */
  onProgress?: (event: ProgressEvent) => void;
}

/**
 * Execute all steps in a plan using the given sandbox.
 * Supports two modes:
 *   - 'sequential' (default): steps run one by one, fail-fast on error.
 *   - 'parallel': steps form a DAG via depends_on; independent steps run concurrently.
 */
export async function executePlan(
  plan: ExecutionPlan,
  sandbox: Sandbox,
  logger: EventLogger,
  runId: string,
  options?: ExecutionOptions,
): Promise<ExecutionResult> {
  if (plan.execution_mode === 'parallel') {
    return executePlanParallel(plan, sandbox, logger, runId, options);
  }
  return executePlanSequential(plan, sandbox, logger, runId, options);
}

// ── Sequential executor (original behavior) ──

async function executePlanSequential(
  plan: ExecutionPlan,
  sandbox: Sandbox,
  logger: EventLogger,
  runId: string,
  options?: ExecutionOptions,
): Promise<ExecutionResult> {
  const stepResults: StepResult[] = [];
  const artifactHashes: `sha256:${string}`[] = [];
  let failed = false;
  let completedCount = 0;
  const totalSteps = plan.steps.length;
  const resultMap = new Map<string, StepResult>();

  const conditionCtx: ConditionContext = {
    env: process.env as Record<string, string | undefined>,
    workspacePath: sandbox.getWorkspacePath(),
    stepResults: resultMap,
  };

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];

    if (failed) {
      const skipped: StepResult = {
        step_id: step.step_id,
        type: step.type,
        description: step.description,
        status: 'skipped',
        determinism: step.determinism,
      };
      stepResults.push(skipped);
      resultMap.set(step.step_id, skipped);
      options?.onProgress?.({
        type: 'step_skipped',
        stepId: step.step_id,
        stepIndex: i,
        totalSteps,
        completedSteps: completedCount,
      });
      continue;
    }

    // Evaluate step condition
    if (step.condition && !evaluateCondition(step.condition, conditionCtx)) {
      const skipped: StepResult = {
        step_id: step.step_id,
        type: step.type,
        description: step.description,
        status: 'skipped',
        determinism: step.determinism,
      };
      stepResults.push(skipped);
      resultMap.set(step.step_id, skipped);
      options?.onProgress?.({
        type: 'step_skipped',
        stepId: step.step_id,
        stepIndex: i,
        totalSteps,
        completedSteps: completedCount,
      });
      continue;
    }

    logger.log(createEvent('step_start', runId, {
      step_id: step.step_id,
      step_type: step.type,
      step_index: i,
    }));

    await options?.hooks?.onStepStart?.(step, i);
    options?.onProgress?.({
      type: 'step_start',
      stepId: step.step_id,
      stepIndex: i,
      totalSteps,
      completedSteps: completedCount,
    });

    const start = Date.now();

    try {
      const timeout = step.timeout_ms ?? options?.defaultTimeoutMs;
      const result = await executeStepWithTimeout(step, sandbox, timeout);
      const duration = Date.now() - start;

      logger.log(createEvent('step_complete', runId, {
        step_id: step.step_id,
        artifact_hash: result.artifactHash,
        duration_ms: duration,
      }));

      logger.log(createEvent('artifact_hashed', runId, {
        step_id: step.step_id,
        artifact_hash: result.artifactHash,
      }));

      artifactHashes.push(result.artifactHash);

      const stepResult: StepResult = {
        step_id: step.step_id,
        type: step.type,
        description: step.description,
        status: 'completed',
        artifact_hash: result.artifactHash,
        duration_ms: duration,
        determinism: step.determinism,
        ...(result.stdout !== undefined ? { stdout: result.stdout } : {}),
        ...(result.stderr !== undefined ? { stderr: result.stderr } : {}),
      };

      stepResults.push(stepResult);
      resultMap.set(step.step_id, stepResult);
      completedCount++;
      await options?.hooks?.onStepComplete?.(step, stepResult);
      options?.onProgress?.({
        type: 'step_complete',
        stepId: step.step_id,
        stepIndex: i,
        totalSteps,
        completedSteps: completedCount,
        durationMs: duration,
      });
    } catch (err: unknown) {
      const duration = Date.now() - start;
      const error = err instanceof Error ? err.message : String(err);
      const exitCode = (err as { exitCode?: number }).exitCode;

      logger.log(createEvent('step_failed', runId, {
        step_id: step.step_id,
        error,
        ...(exitCode !== undefined ? { exit_code: exitCode } : {}),
      }));

      const failedResult: StepResult = {
        step_id: step.step_id,
        type: step.type,
        description: step.description,
        status: 'failed',
        duration_ms: duration,
        determinism: step.determinism,
        error,
        exit_code: exitCode,
      };
      stepResults.push(failedResult);
      resultMap.set(step.step_id, failedResult);

      await options?.hooks?.onStepFailed?.(step, error);
      options?.onProgress?.({
        type: 'step_failed',
        stepId: step.step_id,
        stepIndex: i,
        totalSteps,
        completedSteps: completedCount,
        durationMs: duration,
        error,
      });

      failed = true;
    }
  }

  return { steps: stepResults, artifactHashes };
}

// ── Parallel DAG executor ──

/**
 * Build an adjacency map from step depends_on fields.
 * Validates: no unknown deps, no self-deps, no cycles.
 */
export function buildDependencyGraph(steps: Step[]): {
  dependents: Map<string, string[]>;
  inDegree: Map<string, number>;
} {
  const ids = new Set(steps.map((s) => s.step_id));
  const dependents = new Map<string, string[]>(); // parent → children
  const inDegree = new Map<string, number>();

  for (const step of steps) {
    dependents.set(step.step_id, []);
    inDegree.set(step.step_id, 0);
  }

  for (const step of steps) {
    const deps = step.depends_on ?? [];
    for (const dep of deps) {
      if (!ids.has(dep)) {
        throw new Error(`Step "${step.step_id}" depends on unknown step "${dep}"`);
      }
      if (dep === step.step_id) {
        throw new Error(`Step "${step.step_id}" cannot depend on itself`);
      }
      dependents.get(dep)!.push(step.step_id);
      inDegree.set(step.step_id, (inDegree.get(step.step_id) ?? 0) + 1);
    }
  }

  // Cycle detection via topological sort
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  let visited = 0;
  const tempQueue = [...queue];
  const tempDeg = new Map(inDegree);
  const visitedSet = new Set<string>();
  while (tempQueue.length > 0) {
    const id = tempQueue.shift()!;
    visited++;
    visitedSet.add(id);
    for (const child of dependents.get(id) ?? []) {
      const newDeg = tempDeg.get(child)! - 1;
      tempDeg.set(child, newDeg);
      if (newDeg === 0) tempQueue.push(child);
    }
  }
  if (visited !== steps.length) {
    const cycleSteps = steps
      .filter((s) => !visitedSet.has(s.step_id))
      .map((s) => s.step_id);
    const cycleTrace = traceCycle(cycleSteps, steps);
    throw new Error(
      `Dependency cycle detected: ${cycleTrace.join(' → ')}. ` +
      `All steps in cycle: [${cycleSteps.join(', ')}]`,
    );
  }

  return { dependents, inDegree };
}

/**
 * Trace through cycle participants to produce A → B → C → A chain.
 * Uses DFS from the first unvisited node, following only edges within the cycle set.
 */
function traceCycle(cycleStepIds: string[], steps: Step[]): string[] {
  if (cycleStepIds.length === 0) return [];

  const cycleSet = new Set(cycleStepIds);
  const depsMap = new Map(steps.map((s) => [s.step_id, s.depends_on ?? []]));

  // DFS to find the actual cycle path
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(id: string): string[] | null {
    if (path.includes(id)) {
      // Found the cycle — extract from first occurrence
      const cycleStart = path.indexOf(id);
      return [...path.slice(cycleStart), id];
    }
    if (visited.has(id)) return null;
    visited.add(id);
    path.push(id);

    for (const dep of depsMap.get(id) ?? []) {
      if (!cycleSet.has(dep)) continue;
      const result = dfs(dep);
      if (result) return result;
    }

    path.pop();
    return null;
  }

  for (const startId of cycleStepIds) {
    const result = dfs(startId);
    if (result) return result;
  }

  // Fallback: just list them
  return [...cycleStepIds, cycleStepIds[0]];
}

async function executePlanParallel(
  plan: ExecutionPlan,
  sandbox: Sandbox,
  logger: EventLogger,
  runId: string,
  options?: ExecutionOptions,
): Promise<ExecutionResult> {
  const steps = plan.steps;
  const stepMap = new Map(steps.map((s) => [s.step_id, s]));
  const stepIndex = new Map(steps.map((s, i) => [s.step_id, i]));
  const maxConcurrency = options?.maxConcurrency;
  const concurrencyLimit = maxConcurrency && maxConcurrency > 0 ? maxConcurrency : Infinity;
  const totalSteps = steps.length;
  let completedCount = 0;

  const { dependents, inDegree } = buildDependencyGraph(steps);

  // Condition evaluation context
  const conditionCtx: ConditionContext = {
    env: process.env as Record<string, string | undefined>,
    workspacePath: sandbox.getWorkspacePath(),
    stepResults: new Map<string, StepResult>(),
  };

  // Result containers — indexed by step_id, assembled in plan order at end
  const resultMap = conditionCtx.stepResults;
  const hashMap = new Map<string, `sha256:${string}`>();
  const completedSet = new Set<string>();
  const failedSet = new Set<string>();

  // Track in-degree as mutable copy
  const liveInDegree = new Map(inDegree);

  // Collect initially ready steps (in-degree 0)
  let readyQueue: string[] = [];
  for (const [id, deg] of liveInDegree) {
    if (deg === 0) readyQueue.push(id);
  }

  while (readyQueue.length > 0) {
    // Apply concurrency limit: take only up to concurrencyLimit steps from queue
    const batch = readyQueue.splice(0, concurrencyLimit);

    const promises = batch.map(async (stepId) => {
      const step = stepMap.get(stepId)!;
      const idx = stepIndex.get(stepId)!;

      // If any dependency failed, skip this step
      const deps = step.depends_on ?? [];
      if (deps.some((d) => failedSet.has(d))) {
        failedSet.add(stepId);
        resultMap.set(stepId, {
          step_id: stepId,
          type: step.type,
          description: step.description,
          status: 'skipped',
          determinism: step.determinism,
        });
        options?.onProgress?.({
          type: 'step_skipped',
          stepId,
          stepIndex: idx,
          totalSteps,
          completedSteps: completedCount,
        });
        return;
      }

      // Evaluate step condition
      if (step.condition && !evaluateCondition(step.condition, conditionCtx)) {
        resultMap.set(stepId, {
          step_id: stepId,
          type: step.type,
          description: step.description,
          status: 'skipped',
          determinism: step.determinism,
        });
        options?.onProgress?.({
          type: 'step_skipped',
          stepId,
          stepIndex: idx,
          totalSteps,
          completedSteps: completedCount,
        });
        return;
      }

      logger.log(createEvent('step_start', runId, {
        step_id: stepId,
        step_type: step.type,
        step_index: idx,
      }));

      await options?.hooks?.onStepStart?.(step, idx);
      options?.onProgress?.({
        type: 'step_start',
        stepId,
        stepIndex: idx,
        totalSteps,
        completedSteps: completedCount,
      });

      const start = Date.now();

      try {
        const timeout = step.timeout_ms ?? options?.defaultTimeoutMs;
        const result = await executeStepWithTimeout(step, sandbox, timeout);
        const duration = Date.now() - start;

        logger.log(createEvent('step_complete', runId, {
          step_id: stepId,
          artifact_hash: result.artifactHash,
          duration_ms: duration,
        }));

        logger.log(createEvent('artifact_hashed', runId, {
          step_id: stepId,
          artifact_hash: result.artifactHash,
        }));

        hashMap.set(stepId, result.artifactHash);
        completedSet.add(stepId);

        const stepResult: StepResult = {
          step_id: stepId,
          type: step.type,
          description: step.description,
          status: 'completed',
          artifact_hash: result.artifactHash,
          duration_ms: duration,
          determinism: step.determinism,
          ...(result.stdout !== undefined ? { stdout: result.stdout } : {}),
          ...(result.stderr !== undefined ? { stderr: result.stderr } : {}),
        };

        resultMap.set(stepId, stepResult);
        completedCount++;
        await options?.hooks?.onStepComplete?.(step, stepResult);
        options?.onProgress?.({
          type: 'step_complete',
          stepId,
          stepIndex: idx,
          totalSteps,
          completedSteps: completedCount,
          durationMs: duration,
        });
      } catch (err: unknown) {
        const duration = Date.now() - start;
        const error = err instanceof Error ? err.message : String(err);
        const exitCode = (err as { exitCode?: number }).exitCode;

        logger.log(createEvent('step_failed', runId, {
          step_id: stepId,
          error,
          ...(exitCode !== undefined ? { exit_code: exitCode } : {}),
        }));

        failedSet.add(stepId);

        resultMap.set(stepId, {
          step_id: stepId,
          type: step.type,
          description: step.description,
          status: 'failed',
          duration_ms: duration,
          determinism: step.determinism,
          error,
          exit_code: exitCode,
        });

        await options?.hooks?.onStepFailed?.(step, error);
        options?.onProgress?.({
          type: 'step_failed',
          stepId,
          stepIndex: idx,
          totalSteps,
          completedSteps: completedCount,
          durationMs: duration,
          error,
        });
      }
    });

    await Promise.all(promises);

    // Unblock dependents
    for (const finishedId of batch) {
      for (const child of dependents.get(finishedId) ?? []) {
        const newDeg = liveInDegree.get(child)! - 1;
        liveInDegree.set(child, newDeg);
        if (newDeg === 0) {
          readyQueue.push(child);
        }
      }
    }
  }

  // Assemble results in plan order
  const stepResults: StepResult[] = [];
  const artifactHashes: `sha256:${string}`[] = [];

  for (const step of steps) {
    const result = resultMap.get(step.step_id);
    if (result) {
      stepResults.push(result);
      const hash = hashMap.get(step.step_id);
      if (hash) artifactHashes.push(hash);
    }
  }

  return { steps: stepResults, artifactHashes };
}

// ── Step execution ──

interface StepOutput {
  artifactHash: `sha256:${string}`;
  stdout?: string;
  stderr?: string;
}

/**
 * Execute a step with optional timeout enforcement.
 * If timeout is specified and exceeded, throws a timeout error.
 */
async function executeStepWithTimeout(
  step: Step,
  sandbox: Sandbox,
  timeoutMs?: number,
): Promise<StepOutput> {
  if (!timeoutMs || timeoutMs <= 0) {
    return executeStep(step, sandbox);
  }

  return new Promise<StepOutput>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new StepTimeoutError(step.step_id, timeoutMs));
    }, timeoutMs);

    executeStep(step, sandbox)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function executeStep(step: Step, sandbox: Sandbox): Promise<StepOutput> {
  switch (step.type) {
    case 'create_file':
      return executeCreateFile(step, sandbox);
    case 'run_command':
      return executeRunCommand(step, sandbox);
  }
}

async function executeCreateFile(
  step: CreateFileStep,
  sandbox: Sandbox,
): Promise<StepOutput> {
  await sandbox.writeFile(step.path, step.content);
  const artifactHash = hashString(step.content);
  return { artifactHash };
}

async function executeRunCommand(
  step: RunCommandStep,
  sandbox: Sandbox,
): Promise<StepOutput> {
  const execOpts = step.env ? { env: step.env } : undefined;
  const retry = step.retry;

  if (!retry || retry.max_attempts <= 1) {
    return executeRunCommandOnce(step, sandbox, execOpts);
  }

  // Retry with exponential backoff
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= retry.max_attempts; attempt++) {
    try {
      return await executeRunCommandOnce(step, sandbox, execOpts);
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < retry.max_attempts) {
        const backoff = retry.backoff_ms * Math.pow(2, attempt - 1);
        await sleep(backoff);
      }
    }
  }

  throw lastErr!;
}

async function executeRunCommandOnce(
  step: RunCommandStep,
  sandbox: Sandbox,
  execOpts?: { env: Record<string, string> },
): Promise<StepOutput> {
  const result = await sandbox.exec(step.command, step.args, execOpts);

  if (result.exitCode !== 0) {
    const err = new Error(
      `Command "${step.command} ${step.args.join(' ')}" failed (exit ${result.exitCode}): ${result.stderr}`,
    );
    (err as { exitCode?: number }).exitCode = result.exitCode;
    throw err;
  }

  const artifactHash = hashString(result.stdout);
  const output: StepOutput = { artifactHash };

  if (step.capture_output) {
    output.stdout = result.stdout;
    output.stderr = result.stderr;
  }

  return output;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Error thrown when a step exceeds its timeout. */
export class StepTimeoutError extends Error {
  readonly stepId: string;
  readonly timeoutMs: number;

  constructor(stepId: string, timeoutMs: number) {
    super(`Step "${stepId}" timed out after ${timeoutMs}ms`);
    this.name = 'StepTimeoutError';
    this.stepId = stepId;
    this.timeoutMs = timeoutMs;
  }
}
