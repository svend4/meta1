import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { findCleanupTargets, executeCleanup, cleanup } from '../../src/core/retention.js';
import * as paths from '../../src/core/paths.js';

let tempDir: string;

function createFakeRun(runId: string, startedAt: string): void {
  const runDir = join(tempDir, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'summary.json'), JSON.stringify({
    run_id: runId,
    task_id: randomUUID(),
    prompt: 'test',
    status: 'completed',
    started_at: startedAt,
    completed_at: startedAt,
    duration_ms: 100,
    plan: { plan_id: randomUUID(), steps: [] },
    plan_hash: 'sha256:' + '0'.repeat(64),
    plan_source: 'cache',
    steps: [],
  }, null, 2), 'utf8');
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-retention-'));
  mkdirSync(join(tempDir, 'runs'), { recursive: true });

  vi.spyOn(paths, 'getBaseDir').mockReturnValue(tempDir);
  vi.spyOn(paths, 'getRunsDir').mockReturnValue(join(tempDir, 'runs'));
  vi.spyOn(paths, 'getRunDir').mockImplementation((id) => join(tempDir, 'runs', id));
  vi.spyOn(paths, 'getSummaryPath').mockImplementation((id) => join(tempDir, 'runs', id, 'summary.json'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('retention', () => {
  describe('findCleanupTargets', () => {
    it('finds runs exceeding max count', () => {
      createFakeRun('run-1', '2025-01-01T00:00:00Z');
      createFakeRun('run-2', '2025-01-02T00:00:00Z');
      createFakeRun('run-3', '2025-01-03T00:00:00Z');

      const targets = findCleanupTargets({ maxRuns: 2 });
      expect(targets).toHaveLength(1);
      expect(targets[0].id).toBe('run-1'); // oldest
    });

    it('finds runs exceeding max age', () => {
      const now = new Date();
      const old = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
      const recent = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago

      createFakeRun('old-run', old.toISOString());
      createFakeRun('recent-run', recent.toISOString());

      const targets = findCleanupTargets({ maxAgeDays: 30 });
      expect(targets).toHaveLength(1);
      expect(targets[0].id).toBe('old-run');
    });

    it('deduplicates targets matching both criteria', () => {
      const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      createFakeRun('old-1', old);
      createFakeRun('old-2', old);
      createFakeRun('new-1', new Date().toISOString());

      const targets = findCleanupTargets({ maxRuns: 1, maxAgeDays: 30 });
      const ids = targets.map((t) => t.id);
      const unique = new Set(ids);
      expect(ids.length).toBe(unique.size); // no duplicates
    });

    it('returns empty when nothing to clean', () => {
      createFakeRun('run-1', new Date().toISOString());
      const targets = findCleanupTargets({ maxRuns: 10, maxAgeDays: 365 });
      expect(targets).toHaveLength(0);
    });
  });

  describe('executeCleanup', () => {
    it('removes target directories', () => {
      createFakeRun('to-remove', '2020-01-01T00:00:00Z');
      const runDir = join(tempDir, 'runs', 'to-remove');
      expect(existsSync(runDir)).toBe(true);

      const result = executeCleanup([{
        type: 'run',
        id: 'to-remove',
        age_days: 999,
        path: runDir,
      }]);

      expect(result.removed).toHaveLength(1);
      expect(existsSync(runDir)).toBe(false);
    });

    it('handles already-removed paths gracefully', () => {
      const result = executeCleanup([{
        type: 'run',
        id: 'nonexistent',
        age_days: 0,
        path: join(tempDir, 'runs', 'nonexistent'),
      }]);
      expect(result.removed).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('cleanup', () => {
    it('dry-run does not remove anything', () => {
      createFakeRun('keep-me', '2020-01-01T00:00:00Z');
      const runDir = join(tempDir, 'runs', 'keep-me');

      const { targets, result } = cleanup({ maxAgeDays: 1, dryRun: true });
      expect(targets.length).toBeGreaterThan(0);
      expect(result).toBeUndefined();
      expect(existsSync(runDir)).toBe(true);
    });

    it('removes runs when not dry-run', () => {
      createFakeRun('remove-me', '2020-01-01T00:00:00Z');
      const runDir = join(tempDir, 'runs', 'remove-me');

      const { result } = cleanup({ maxAgeDays: 1 });
      expect(result!.removed.length).toBeGreaterThan(0);
      expect(existsSync(runDir)).toBe(false);
    });
  });
});
