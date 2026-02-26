import type { ExecutionPlan, Step, CreateFileStep, RunCommandStep } from '../types/execution-plan.js';
import type { StepResult } from '../types/run-summary.js';
import type { Sandbox } from '../sandbox/types.js';
import { EventLogger, createEvent } from './logger.js';
import { hashString } from './hasher.js';

export interface ExecutionResult {
  steps: StepResult[];
  artifactHashes: `sha256:${string}`[];
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
): Promise<ExecutionResult> {
  if (plan.execution_mode === 'parallel') {
    return executePlanParallel(plan, sandbox, logger, runId);
  }
  return executePlanSequential(plan, sandbox, logger, runId);
}

// ── Sequential executor (original behavior) ──

async function executePlanSequential(
  plan: ExecutionPlan,
  sandbox: Sandbox,
  logger: EventLogger,
  runId: string,
): Promise<ExecutionResult> {
  const stepResults: StepResult[] = [];
  const artifactHashes: `sha256:${string}`[] = [];
  let failed = false;

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];

    if (failed) {
      stepResults.push({
        step_id: step.step_id,
        type: step.type,
        description: step.description,
        status: 'skipped',
        determinism: step.determinism,
      });
      continue;
    }

    logger.log(createEvent('step_start', runId, {
      step_id: step.step_id,
      step_type: step.type,
      step_index: i,
    }));

    const start = Date.now();

    try {
      const result = await executeStep(step, sandbox);
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

      stepResults.push({
        step_id: step.step_id,
        type: step.type,
        description: step.description,
        status: 'completed',
        artifact_hash: result.artifactHash,
        duration_ms: duration,
        determinism: step.determinism,
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

      stepResults.push({
        step_id: step.step_id,
        type: step.type,
        description: step.description,
        status: 'failed',
        duration_ms: duration,
        determinism: step.determinism,
        error,
        exit_code: exitCode,
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
  while (tempQueue.length > 0) {
    const id = tempQueue.shift()!;
    visited++;
    for (const child of dependents.get(id) ?? []) {
      const newDeg = tempDeg.get(child)! - 1;
      tempDeg.set(child, newDeg);
      if (newDeg === 0) tempQueue.push(child);
    }
  }
  if (visited !== steps.length) {
    throw new Error('Dependency cycle detected in plan steps');
  }

  return { dependents, inDegree };
}

async function executePlanParallel(
  plan: ExecutionPlan,
  sandbox: Sandbox,
  logger: EventLogger,
  runId: string,
): Promise<ExecutionResult> {
  const steps = plan.steps;
  const stepMap = new Map(steps.map((s) => [s.step_id, s]));
  const stepIndex = new Map(steps.map((s, i) => [s.step_id, i]));

  const { dependents, inDegree } = buildDependencyGraph(steps);

  // Result containers — indexed by step_id, assembled in plan order at end
  const resultMap = new Map<string, StepResult>();
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
    // Execute all ready steps concurrently
    const batch = [...readyQueue];
    readyQueue = [];

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
        return;
      }

      logger.log(createEvent('step_start', runId, {
        step_id: stepId,
        step_type: step.type,
        step_index: idx,
      }));

      const start = Date.now();

      try {
        const result = await executeStep(step, sandbox);
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

        resultMap.set(stepId, {
          step_id: stepId,
          type: step.type,
          description: step.description,
          status: 'completed',
          artifact_hash: result.artifactHash,
          duration_ms: duration,
          determinism: step.determinism,
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
  const result = await sandbox.exec(step.command, step.args);

  if (result.exitCode !== 0) {
    const err = new Error(
      `Command "${step.command} ${step.args.join(' ')}" failed (exit ${result.exitCode}): ${result.stderr}`,
    );
    (err as { exitCode?: number }).exitCode = result.exitCode;
    throw err;
  }

  const artifactHash = hashString(result.stdout);
  return { artifactHash };
}
