import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  saveCheckpoint,
  loadCheckpoint,
  removeCheckpoint,
  hasCheckpoint,
  getRemainingSteps,
  validateCheckpoint,
} from '../../src/core/checkpoint.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';
import type { StepResult } from '../../src/types/run-summary.js';

let tempDir: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
}));

describe('checkpoint', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-checkpoint-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves and loads a checkpoint', () => {
    const steps: StepResult[] = [
      { step_id: 's1', type: 'create_file', status: 'completed', artifact_hash: 'sha256:aaa' },
      { step_id: 's2', type: 'run_command', status: 'completed', artifact_hash: 'sha256:bbb' },
    ];

    const cp = saveCheckpoint('run-1', 'sha256:planhash' as `sha256:${string}`, steps, ['sha256:aaa' as `sha256:${string}`, 'sha256:bbb' as `sha256:${string}`]);

    expect(cp.run_id).toBe('run-1');
    expect(cp.completed_step_ids).toEqual(['s1', 's2']);
    expect(cp.version).toBe('1.0');

    const loaded = loadCheckpoint('run-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.run_id).toBe('run-1');
    expect(loaded!.completed_steps).toHaveLength(2);
  });

  it('returns null for nonexistent checkpoint', () => {
    expect(loadCheckpoint('ghost')).toBeNull();
  });

  it('detects integrity corruption', () => {
    const steps: StepResult[] = [
      { step_id: 's1', type: 'create_file', status: 'completed' },
    ];

    saveCheckpoint('run-2', 'sha256:abc' as `sha256:${string}`, steps, []);

    // Tamper with file
    const { readFileSync, writeFileSync } = require('node:fs');
    const path = join(tempDir, 'checkpoints', 'run-2.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    data.completed_step_ids = ['tampered'];
    writeFileSync(path, JSON.stringify(data, null, 2));

    expect(() => loadCheckpoint('run-2')).toThrow('integrity check failed');
  });

  it('removes a checkpoint', () => {
    saveCheckpoint('run-3', 'sha256:xyz' as `sha256:${string}`, [], []);
    expect(hasCheckpoint('run-3')).toBe(true);

    const removed = removeCheckpoint('run-3');
    expect(removed).toBe(true);
    expect(hasCheckpoint('run-3')).toBe(false);
  });

  it('returns false when removing nonexistent', () => {
    expect(removeCheckpoint('ghost')).toBe(false);
  });

  it('tracks failed step ID', () => {
    const steps: StepResult[] = [
      { step_id: 's1', type: 'create_file', status: 'completed' },
      { step_id: 's2', type: 'run_command', status: 'failed', error: 'boom' },
    ];

    const cp = saveCheckpoint('run-4', 'sha256:def' as `sha256:${string}`, steps, []);
    expect(cp.failed_step_id).toBe('s2');
  });

  it('tracks skipped steps', () => {
    const steps: StepResult[] = [
      { step_id: 's1', type: 'create_file', status: 'completed' },
      { step_id: 's2', type: 'run_command', status: 'skipped' },
    ];

    const cp = saveCheckpoint('run-5', 'sha256:ghi' as `sha256:${string}`, steps, []);
    expect(cp.skipped_step_ids).toEqual(['s2']);
  });

  it('getRemainingSteps returns unfinished steps', () => {
    const plan: ExecutionPlan = {
      plan_id: 'p1',
      steps: [
        { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 's2', type: 'create_file', description: '', path: 'b', content: '', determinism: 'guaranteed' },
        { step_id: 's3', type: 'create_file', description: '', path: 'c', content: '', determinism: 'guaranteed' },
      ],
    };

    const steps: StepResult[] = [
      { step_id: 's1', type: 'create_file', status: 'completed' },
    ];

    const cp = saveCheckpoint('run-6', 'sha256:jkl' as `sha256:${string}`, steps, []);
    const remaining = getRemainingSteps(plan, cp);
    expect(remaining).toEqual(['s2', 's3']);
  });

  it('validates checkpoint plan hash', () => {
    const steps: StepResult[] = [];
    const cp = saveCheckpoint('run-7', 'sha256:original' as `sha256:${string}`, steps, []);

    expect(validateCheckpoint(cp, 'sha256:original' as `sha256:${string}`).valid).toBe(true);
    expect(validateCheckpoint(cp, 'sha256:changed' as `sha256:${string}`).valid).toBe(false);
  });
});
