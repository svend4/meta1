import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  computeStepInputHash,
  lookupStepCache,
  storeStepCache,
  clearStepCache,
  getStepCacheStats,
} from '../../src/core/step-cache.js';
import type { Step, CreateFileStep, RunCommandStep } from '../../src/types/execution-plan.js';

// Mock paths to use temp dir
let tempDir: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
}));

describe('step-cache', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-step-cache-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const fileStep: CreateFileStep = {
    step_id: 'create-readme',
    type: 'create_file',
    description: 'Create README',
    path: 'README.md',
    content: '# Hello',
    determinism: 'guaranteed',
  };

  const cmdStep: RunCommandStep = {
    step_id: 'run-test',
    type: 'run_command',
    description: 'Run tests',
    command: 'npm',
    args: ['test'],
    determinism: 'best_effort',
  };

  it('computeStepInputHash produces deterministic hash for same step', () => {
    const h1 = computeStepInputHash(fileStep);
    const h2 = computeStepInputHash(fileStep);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^sha256:/);
  });

  it('computeStepInputHash differs for different content', () => {
    const modified = { ...fileStep, content: '# Different' };
    expect(computeStepInputHash(fileStep)).not.toBe(computeStepInputHash(modified));
  });

  it('computeStepInputHash differs for different commands', () => {
    const modified = { ...cmdStep, command: 'yarn' };
    expect(computeStepInputHash(cmdStep)).not.toBe(computeStepInputHash(modified as RunCommandStep));
  });

  it('returns null for cache miss', () => {
    expect(lookupStepCache(fileStep)).toBeNull();
  });

  it('stores and retrieves cached step', () => {
    storeStepCache(fileStep, 'sha256:abc123');
    const entry = lookupStepCache(fileStep);

    expect(entry).not.toBeNull();
    expect(entry!.artifact_hash).toBe('sha256:abc123');
    expect(entry!.step_id).toBe('create-readme');
  });

  it('returns null when input changes after caching', () => {
    storeStepCache(fileStep, 'sha256:abc123');

    const modified = { ...fileStep, content: '# Changed' };
    expect(lookupStepCache(modified)).toBeNull();
  });

  it('stores output for command steps', () => {
    storeStepCache(cmdStep, 'sha256:def456', { stdout: 'ok', stderr: '' });
    const entry = lookupStepCache(cmdStep);

    expect(entry!.stdout).toBe('ok');
    expect(entry!.stderr).toBe('');
  });

  it('clears all cached steps', () => {
    storeStepCache(fileStep, 'sha256:abc');
    storeStepCache(cmdStep, 'sha256:def');

    const cleared = clearStepCache();
    expect(cleared).toBe(2);
    expect(lookupStepCache(fileStep)).toBeNull();
  });

  it('returns step cache stats', () => {
    storeStepCache(fileStep, 'sha256:abc');
    storeStepCache(cmdStep, 'sha256:def');

    const stats = getStepCacheStats();
    expect(stats.entries).toBe(2);
    expect(stats.totalBytes).toBeGreaterThan(0);
  });

  it('returns empty stats when no cache exists', () => {
    const stats = getStepCacheStats();
    expect(stats.entries).toBe(0);
    expect(stats.totalBytes).toBe(0);
  });
});
