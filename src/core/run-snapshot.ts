/**
 * Run snapshot & restore — save complete run execution state at any point
 * and restore to resume from that snapshot. Captures step results,
 * environment, progress, and execution context.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getBaseDir } from './paths.js';
import type { ExecutionPlan } from '../types/execution-plan.js';

/** Result of a single step (minimal) */
export interface SnapshotStepResult {
  stepId: string;
  status: 'completed' | 'failed' | 'skipped' | 'pending';
  exitCode?: number;
  output?: string;
  error?: string;
  durationMs?: number;
}

/** A complete run state snapshot */
export interface RunSnapshot {
  snapshotId: string;
  runId: string;
  createdAt: string;
  /** The plan being executed */
  plan: ExecutionPlan;
  /** Which step index we're at (next step to execute) */
  currentStepIndex: number;
  /** Results of completed steps */
  stepResults: SnapshotStepResult[];
  /** Environment variables at snapshot time */
  environment: Record<string, string>;
  /** Elapsed time before snapshot (ms) */
  elapsedMs: number;
  /** Arbitrary metadata */
  metadata: Record<string, unknown>;
}

/** Options for creating a snapshot */
export interface SnapshotOptions {
  /** Custom snapshot ID */
  snapshotId?: string;
  /** Additional metadata to store */
  metadata?: Record<string, unknown>;
}

/** Result of restoring a snapshot */
export interface RestoreResult {
  snapshot: RunSnapshot;
  /** Step index to resume from */
  resumeFromStep: number;
  /** Steps already completed (can be skipped) */
  completedSteps: string[];
  /** Steps still pending */
  pendingSteps: string[];
}

function getSnapshotDir(): string {
  return join(getBaseDir(), 'run-snapshots');
}

/**
 * Save a run state snapshot.
 */
export function saveRunSnapshot(
  runId: string,
  plan: ExecutionPlan,
  currentStepIndex: number,
  stepResults: SnapshotStepResult[],
  elapsedMs: number,
  options?: SnapshotOptions,
): RunSnapshot {
  const dir = getSnapshotDir();
  mkdirSync(dir, { recursive: true });

  const snapshotId = options?.snapshotId ?? `snap-${runId}-${Date.now()}`;

  const snapshot: RunSnapshot = {
    snapshotId,
    runId,
    createdAt: new Date().toISOString(),
    plan,
    currentStepIndex,
    stepResults,
    environment: { ...process.env } as Record<string, string>,
    elapsedMs,
    metadata: options?.metadata ?? {},
  };

  const filePath = join(dir, `${snapshotId}.json`);
  writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');

  return snapshot;
}

/**
 * Load a run snapshot by ID.
 */
export function loadRunSnapshot(snapshotId: string): RunSnapshot | null {
  const filePath = join(getSnapshotDir(), `${snapshotId}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/**
 * List all snapshots, optionally filtered by run ID.
 */
export function listRunSnapshots(runId?: string): RunSnapshot[] {
  const dir = getSnapshotDir();
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const snapshots: RunSnapshot[] = [];

  for (const file of files) {
    const snap = JSON.parse(readFileSync(join(dir, file), 'utf8')) as RunSnapshot;
    if (!runId || snap.runId === runId) {
      snapshots.push(snap);
    }
  }

  return snapshots.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Delete a snapshot.
 */
export function deleteRunSnapshot(snapshotId: string): boolean {
  const filePath = join(getSnapshotDir(), `${snapshotId}.json`);
  if (!existsSync(filePath)) return false;
  rmSync(filePath);
  return true;
}

/**
 * Restore from a snapshot — compute what's left to do.
 */
export function restoreFromSnapshot(snapshotId: string): RestoreResult | null {
  const snapshot = loadRunSnapshot(snapshotId);
  if (!snapshot) return null;

  const completedSteps = snapshot.stepResults
    .filter((r) => r.status === 'completed')
    .map((r) => r.stepId);

  const allStepIds = snapshot.plan.steps.map((s) => s.step_id);
  const completedSet = new Set(completedSteps);
  const pendingSteps = allStepIds.filter((id) => !completedSet.has(id));

  return {
    snapshot,
    resumeFromStep: snapshot.currentStepIndex,
    completedSteps,
    pendingSteps,
  };
}

/**
 * Create a snapshot from current execution progress.
 * Convenience wrapper that auto-builds step results from completed/pending lists.
 */
export function snapshotFromProgress(
  runId: string,
  plan: ExecutionPlan,
  completedStepIds: string[],
  stepOutputs: Map<string, { exitCode?: number; output?: string; durationMs?: number }>,
  elapsedMs: number,
  options?: SnapshotOptions,
): RunSnapshot {
  const completedSet = new Set(completedStepIds);
  const stepResults: SnapshotStepResult[] = plan.steps.map((step) => {
    if (completedSet.has(step.step_id)) {
      const output = stepOutputs.get(step.step_id);
      return {
        stepId: step.step_id,
        status: 'completed' as const,
        exitCode: output?.exitCode ?? 0,
        output: output?.output,
        durationMs: output?.durationMs,
      };
    }
    return { stepId: step.step_id, status: 'pending' as const };
  });

  const currentStepIndex = plan.steps.findIndex((s) => !completedSet.has(s.step_id));

  return saveRunSnapshot(
    runId,
    plan,
    currentStepIndex === -1 ? plan.steps.length : currentStepIndex,
    stepResults,
    elapsedMs,
    options,
  );
}

/**
 * Format snapshot for display.
 */
export function formatRunSnapshot(snapshot: RunSnapshot): string {
  const lines: string[] = [];
  const completed = snapshot.stepResults.filter((r) => r.status === 'completed').length;
  const total = snapshot.plan.steps.length;

  lines.push(`Run Snapshot: ${snapshot.snapshotId}`);
  lines.push(`  Run: ${snapshot.runId}`);
  lines.push(`  Created: ${snapshot.createdAt}`);
  lines.push(`  Progress: ${completed}/${total} steps completed`);
  lines.push(`  Elapsed: ${snapshot.elapsedMs}ms`);
  lines.push(`  Resume from step: ${snapshot.currentStepIndex}`);

  if (Object.keys(snapshot.metadata).length > 0) {
    lines.push(`  Metadata: ${JSON.stringify(snapshot.metadata)}`);
  }

  return lines.join('\n');
}
