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
 * Execute all steps in a plan sequentially using the given sandbox.
 * Logs step_start, step_complete/step_failed, and artifact_hashed events.
 * Stops on first failure — remaining steps are marked "skipped".
 */
export async function executePlan(
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
