import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { StepResult } from '../types/run-summary.js';
import type { ExecutionPlan } from '../types/execution-plan.js';
import { getBaseDir } from './paths.js';
import { hashObject } from './hasher.js';

/** A checkpoint representing partial execution state */
export interface ExecutionCheckpoint {
  /** Checkpoint version for forward compatibility */
  version: '1.0';
  /** Run ID this checkpoint belongs to */
  run_id: string;
  /** Plan hash to verify plan hasn't changed */
  plan_hash: `sha256:${string}`;
  /** Completed step results */
  completed_steps: StepResult[];
  /** Step IDs that have been completed */
  completed_step_ids: string[];
  /** Step IDs that were skipped */
  skipped_step_ids: string[];
  /** Step ID that failed, if execution was interrupted by failure */
  failed_step_id?: string;
  /** When the checkpoint was created */
  created_at: string;
  /** Collected artifact hashes */
  artifact_hashes: `sha256:${string}`[];
  /** Integrity hash */
  checkpoint_hash: `sha256:${string}`;
}

function getCheckpointDir(): string {
  return join(getBaseDir(), 'checkpoints');
}

function getCheckpointPath(runId: string): string {
  return join(getCheckpointDir(), `${runId}.json`);
}

/**
 * Save an execution checkpoint.
 */
export function saveCheckpoint(
  runId: string,
  planHash: `sha256:${string}`,
  completedSteps: StepResult[],
  artifactHashes: `sha256:${string}`[],
): ExecutionCheckpoint {
  const dir = getCheckpointDir();
  mkdirSync(dir, { recursive: true });

  const completedStepIds = completedSteps
    .filter((s) => s.status === 'completed')
    .map((s) => s.step_id);

  const skippedStepIds = completedSteps
    .filter((s) => s.status === 'skipped')
    .map((s) => s.step_id);

  const failedStep = completedSteps.find((s) => s.status === 'failed');

  const partial: Omit<ExecutionCheckpoint, 'checkpoint_hash'> = {
    version: '1.0',
    run_id: runId,
    plan_hash: planHash,
    completed_steps: completedSteps,
    completed_step_ids: completedStepIds,
    skipped_step_ids: skippedStepIds,
    failed_step_id: failedStep?.step_id,
    created_at: new Date().toISOString(),
    artifact_hashes: artifactHashes,
  };

  const checkpoint: ExecutionCheckpoint = {
    ...partial,
    checkpoint_hash: hashObject(partial),
  };

  writeFileSync(getCheckpointPath(runId), JSON.stringify(checkpoint, null, 2), 'utf8');
  return checkpoint;
}

/**
 * Load a checkpoint for a run.
 * Returns null if no checkpoint exists.
 */
export function loadCheckpoint(runId: string): ExecutionCheckpoint | null {
  const path = getCheckpointPath(runId);
  if (!existsSync(path)) return null;

  const checkpoint = JSON.parse(readFileSync(path, 'utf8')) as ExecutionCheckpoint;

  // Verify integrity
  const { checkpoint_hash, ...rest } = checkpoint;
  const computed = hashObject(rest);
  if (computed !== checkpoint_hash) {
    throw new Error(
      `Checkpoint integrity check failed for run ${runId}: ` +
      `expected ${checkpoint_hash}, got ${computed}`,
    );
  }

  return checkpoint;
}

/**
 * Remove a checkpoint (typically after successful completion).
 */
export function removeCheckpoint(runId: string): boolean {
  const path = getCheckpointPath(runId);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/**
 * Check if a checkpoint exists for a run.
 */
export function hasCheckpoint(runId: string): boolean {
  return existsSync(getCheckpointPath(runId));
}

/**
 * Determine which steps remain to be executed, given a checkpoint.
 * Returns step IDs that are neither completed nor skipped.
 */
export function getRemainingSteps(
  plan: ExecutionPlan,
  checkpoint: ExecutionCheckpoint,
): string[] {
  const done = new Set([
    ...checkpoint.completed_step_ids,
    ...checkpoint.skipped_step_ids,
    ...(checkpoint.failed_step_id ? [checkpoint.failed_step_id] : []),
  ]);

  return plan.steps
    .filter((s) => !done.has(s.step_id))
    .map((s) => s.step_id);
}

/**
 * Validate that a checkpoint is compatible with a plan.
 * Ensures the plan hasn't changed since the checkpoint was created.
 */
export function validateCheckpoint(
  checkpoint: ExecutionCheckpoint,
  planHash: `sha256:${string}`,
): { valid: boolean; reason?: string } {
  if (checkpoint.plan_hash !== planHash) {
    return {
      valid: false,
      reason: `Plan has changed since checkpoint: checkpoint=${checkpoint.plan_hash}, current=${planHash}`,
    };
  }
  return { valid: true };
}
