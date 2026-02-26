import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { lookupPlan, storePlan, clearExpired, getCacheStats, DEFAULT_CACHE_TTL_MS } from '../../src/core/plan-cache.js';
import * as paths from '../../src/core/paths.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';

let tempDir: string;

const testPlan: ExecutionPlan = {
  plan_id: randomUUID(),
  steps: [
    {
      step_id: 'step-1',
      type: 'create_file',
      description: 'Create test file',
      path: 'test.txt',
      content: 'hello',
      determinism: 'guaranteed',
    },
  ],
};

const testParams = {
  prompt: 'test prompt',
  model: 'test-model',
  systemPromptHash: 'sha256:' + 'a'.repeat(64) as `sha256:${string}`,
};

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-cache-ttl-'));
  vi.spyOn(paths, 'getBaseDir').mockReturnValue(tempDir);
  vi.spyOn(paths, 'getPlanCacheDir').mockReturnValue(join(tempDir, 'cache', 'plans'));
  vi.spyOn(paths, 'getCachedPlanPath').mockImplementation((cacheKey: string) => {
    const hex = cacheKey.replace('sha256:', '');
    return join(tempDir, 'cache', 'plans', `${hex}.json`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('lookupPlan with TTL', () => {
  it('returns hit when cache is fresh', () => {
    storePlan(testPlan, testParams);
    const result = lookupPlan(testParams, DEFAULT_CACHE_TTL_MS);
    expect(result.hit).toBe(true);
  });

  it('returns expired miss when cache is stale', () => {
    const cacheKey = storePlan(testPlan, testParams);
    const hex = cacheKey.replace('sha256:', '');
    const filePath = join(tempDir, 'cache', 'plans', `${hex}.json`);

    // Set mtime to 8 days ago
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(filePath, eightDaysAgo, eightDaysAgo);

    const result = lookupPlan(testParams, DEFAULT_CACHE_TTL_MS);
    expect(result.hit).toBe(false);
    if (!result.hit) {
      expect(result.reason).toBe('expired');
    }
  });

  it('ignores TTL when set to 0', () => {
    const cacheKey = storePlan(testPlan, testParams);
    const hex = cacheKey.replace('sha256:', '');
    const filePath = join(tempDir, 'cache', 'plans', `${hex}.json`);

    // Make old
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    utimesSync(filePath, oldDate, oldDate);

    const result = lookupPlan(testParams, 0);
    expect(result.hit).toBe(true);
  });

  it('ignores TTL when set to Infinity', () => {
    const cacheKey = storePlan(testPlan, testParams);
    const hex = cacheKey.replace('sha256:', '');
    const filePath = join(tempDir, 'cache', 'plans', `${hex}.json`);

    const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    utimesSync(filePath, oldDate, oldDate);

    const result = lookupPlan(testParams, Infinity);
    expect(result.hit).toBe(true);
  });

  it('default (no ttl arg) does not expire', () => {
    const cacheKey = storePlan(testPlan, testParams);
    const hex = cacheKey.replace('sha256:', '');
    const filePath = join(tempDir, 'cache', 'plans', `${hex}.json`);

    const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    utimesSync(filePath, oldDate, oldDate);

    const result = lookupPlan(testParams);
    expect(result.hit).toBe(true);
  });
});

describe('clearExpired', () => {
  it('removes only expired entries', () => {
    storePlan(testPlan, testParams);

    // Create a second entry manually that's old
    const oldDir = join(tempDir, 'cache', 'plans');
    const oldFile = join(oldDir, 'old_entry.json');
    writeFileSync(oldFile, JSON.stringify(testPlan), 'utf8');
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    utimesSync(oldFile, tenDaysAgo, tenDaysAgo);

    const removed = clearExpired(DEFAULT_CACHE_TTL_MS);
    expect(removed).toBe(1);

    // Fresh entry still exists
    const result = lookupPlan(testParams);
    expect(result.hit).toBe(true);
  });

  it('returns 0 when nothing is expired', () => {
    storePlan(testPlan, testParams);
    const removed = clearExpired(DEFAULT_CACHE_TTL_MS);
    expect(removed).toBe(0);
  });

  it('returns 0 when cache dir does not exist', () => {
    const removed = clearExpired(DEFAULT_CACHE_TTL_MS);
    expect(removed).toBe(0);
  });

  it('handles custom TTL', () => {
    storePlan(testPlan, testParams);

    // Get the file path
    const result = lookupPlan(testParams);
    expect(result.hit).toBe(true);

    // Set mtime to 2 hours ago
    const cacheDir = join(tempDir, 'cache', 'plans');
    const files = readdirSync(cacheDir);
    for (const file of files) {
      const filePath = join(cacheDir, file);
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      utimesSync(filePath, twoHoursAgo, twoHoursAgo);
    }

    // 1 hour TTL should expire the 2-hour-old entry
    const removed = clearExpired(1 * 60 * 60 * 1000);
    expect(removed).toBe(1);
  });
});

describe('getCacheStats', () => {
  it('returns zeros for empty cache', () => {
    const stats = getCacheStats();
    expect(stats.entries).toBe(0);
    expect(stats.oldestAgeMs).toBe(0);
    expect(stats.totalBytes).toBe(0);
  });

  it('reports correct entry count', () => {
    storePlan(testPlan, testParams);
    const stats = getCacheStats();
    expect(stats.entries).toBe(1);
    expect(stats.totalBytes).toBeGreaterThan(0);
  });

  it('reports oldest age correctly', () => {
    storePlan(testPlan, testParams);

    // Create an old entry
    const oldDir = join(tempDir, 'cache', 'plans');
    const oldFile = join(oldDir, 'old_stats.json');
    writeFileSync(oldFile, '{}', 'utf8');
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    utimesSync(oldFile, threeDaysAgo, threeDaysAgo);

    const stats = getCacheStats();
    expect(stats.entries).toBe(2);
    // Oldest should be roughly 3 days
    expect(stats.oldestAgeMs).toBeGreaterThan(2.9 * 24 * 60 * 60 * 1000);
  });

  it('returns 0 when dir does not exist', () => {
    const stats = getCacheStats();
    expect(stats.entries).toBe(0);
  });
});

describe('DEFAULT_CACHE_TTL_MS', () => {
  it('is 7 days', () => {
    expect(DEFAULT_CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
