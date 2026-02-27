import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  saveRunSnapshot,
  loadRunSnapshot,
  listRunSnapshots,
  deleteRunSnapshot,
  restoreFromSnapshot,
  snapshotFromProgress,
  formatRunSnapshot,
} from '../../src/core/run-snapshot.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';

let tempDir: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
}));

const testPlan: ExecutionPlan = {
  plan_id: 'test-plan',
  steps: [
    { step_id: 's1', type: 'create_file', description: 'Create', path: 'a.txt', content: 'hello', determinism: 'guaranteed' },
    { step_id: 's2', type: 'run_command', description: 'Build', command: 'npm', args: ['build'], determinism: 'best_effort' },
    { step_id: 's3', type: 'run_command', description: 'Test', command: 'npm', args: ['test'], determinism: 'best_effort' },
  ],
};

describe('run-snapshot', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-snap-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves and loads a snapshot', () => {
    const snap = saveRunSnapshot('run-1', testPlan, 1, [
      { stepId: 's1', status: 'completed', exitCode: 0 },
    ], 500);

    const loaded = loadRunSnapshot(snap.snapshotId);
    expect(loaded).toBeDefined();
    expect(loaded!.runId).toBe('run-1');
    expect(loaded!.currentStepIndex).toBe(1);
    expect(loaded!.stepResults).toHaveLength(1);
  });

  it('saves with custom snapshot ID', () => {
    const snap = saveRunSnapshot('run-1', testPlan, 0, [], 0, { snapshotId: 'custom-snap' });
    expect(snap.snapshotId).toBe('custom-snap');

    const loaded = loadRunSnapshot('custom-snap');
    expect(loaded).toBeDefined();
  });

  it('saves with metadata', () => {
    const snap = saveRunSnapshot('run-1', testPlan, 0, [], 0, {
      metadata: { reason: 'manual checkpoint' },
    });
    expect(snap.metadata.reason).toBe('manual checkpoint');
  });

  it('returns null for unknown snapshot', () => {
    expect(loadRunSnapshot('ghost')).toBeNull();
  });

  it('lists snapshots', () => {
    saveRunSnapshot('run-1', testPlan, 0, [], 0, { snapshotId: 'snap-a' });
    saveRunSnapshot('run-2', testPlan, 1, [], 100, { snapshotId: 'snap-b' });

    const all = listRunSnapshots();
    expect(all).toHaveLength(2);
  });

  it('lists snapshots filtered by run ID', () => {
    saveRunSnapshot('run-1', testPlan, 0, [], 0, { snapshotId: 'snap-a' });
    saveRunSnapshot('run-2', testPlan, 1, [], 100, { snapshotId: 'snap-b' });

    const filtered = listRunSnapshots('run-1');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].runId).toBe('run-1');
  });

  it('deletes a snapshot', () => {
    saveRunSnapshot('run-1', testPlan, 0, [], 0, { snapshotId: 'to-delete' });
    expect(deleteRunSnapshot('to-delete')).toBe(true);
    expect(loadRunSnapshot('to-delete')).toBeNull();
  });

  it('returns false deleting unknown snapshot', () => {
    expect(deleteRunSnapshot('ghost')).toBe(false);
  });

  it('restores from snapshot', () => {
    saveRunSnapshot('run-1', testPlan, 1, [
      { stepId: 's1', status: 'completed', exitCode: 0, durationMs: 50 },
      { stepId: 's2', status: 'pending' },
      { stepId: 's3', status: 'pending' },
    ], 500, { snapshotId: 'restore-me' });

    const result = restoreFromSnapshot('restore-me');
    expect(result).toBeDefined();
    expect(result!.resumeFromStep).toBe(1);
    expect(result!.completedSteps).toEqual(['s1']);
    expect(result!.pendingSteps).toEqual(['s2', 's3']);
  });

  it('returns null restoring unknown', () => {
    expect(restoreFromSnapshot('ghost')).toBeNull();
  });

  it('creates snapshot from progress', () => {
    const outputs = new Map<string, { exitCode?: number; output?: string; durationMs?: number }>();
    outputs.set('s1', { exitCode: 0, output: 'created a.txt', durationMs: 10 });

    const snap = snapshotFromProgress('run-1', testPlan, ['s1'], outputs, 1000);

    expect(snap.currentStepIndex).toBe(1);
    expect(snap.stepResults[0].status).toBe('completed');
    expect(snap.stepResults[0].output).toBe('created a.txt');
    expect(snap.stepResults[1].status).toBe('pending');
  });

  it('snapshot from progress with all complete', () => {
    const outputs = new Map<string, { exitCode?: number; output?: string; durationMs?: number }>();
    outputs.set('s1', { exitCode: 0 });
    outputs.set('s2', { exitCode: 0 });
    outputs.set('s3', { exitCode: 0 });

    const snap = snapshotFromProgress('run-done', testPlan, ['s1', 's2', 's3'], outputs, 5000);
    expect(snap.currentStepIndex).toBe(3);
  });

  it('formats snapshot', () => {
    const snap = saveRunSnapshot('run-1', testPlan, 1, [
      { stepId: 's1', status: 'completed' },
    ], 500);

    const output = formatRunSnapshot(snap);
    expect(output).toContain('run-1');
    expect(output).toContain('1/3');
    expect(output).toContain('500ms');
  });
});
