import { describe, it, expect, vi } from 'vitest';
import { getSystemStatus, formatStatus } from '../../src/core/status.js';

// Mock all external dependencies
vi.mock('../../src/storage/runs.js', () => ({
  listRunSummaries: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/core/config.js', () => ({
  findConfigFile: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/core/plan-cache.js', () => ({
  getCacheStats: vi.fn().mockReturnValue({ entries: 0, totalBytes: 0, oldestAgeMs: 0 }),
}));

vi.mock('../../src/core/step-cache.js', () => ({
  getStepCacheStats: vi.fn().mockReturnValue({ entries: 0, totalBytes: 0 }),
}));

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: vi.fn().mockReturnValue('/tmp/test-continuum'),
}));

import { listRunSummaries } from '../../src/storage/runs.js';
import { findConfigFile } from '../../src/core/config.js';
import type { RunSummary } from '../../src/types/run-summary.js';

const mockListRuns = vi.mocked(listRunSummaries);
const mockFindConfig = vi.mocked(findConfigFile);

function makeRun(overrides: Partial<RunSummary>): RunSummary {
  return {
    run_id: 'run-1',
    task_id: 'task-1',
    prompt: 'test',
    status: 'completed',
    started_at: new Date().toISOString(),
    duration_ms: 1000,
    plan: { plan_id: 'p1', steps: [] },
    plan_hash: 'sha256:abc',
    plan_source: 'llm',
    steps: [{ step_id: 's1', type: 'run_command', status: 'completed' }],
    ...overrides,
  } as RunSummary;
}

describe('getSystemStatus', () => {
  it('returns status with no runs', () => {
    mockListRuns.mockReturnValue([]);
    const status = getSystemStatus();

    expect(status.recentStats.totalRuns).toBe(0);
    expect(status.recentRuns).toHaveLength(0);
    expect(status.healthScore).toBeLessThanOrEqual(100);
  });

  it('reports recent runs', () => {
    mockListRuns.mockReturnValue([
      makeRun({ run_id: 'r1' }),
      makeRun({ run_id: 'r2' }),
    ]);

    const status = getSystemStatus();
    expect(status.recentRuns).toHaveLength(2);
    expect(status.recentStats.totalRuns).toBe(2);
  });

  it('limits recent runs to 5', () => {
    const runs = Array.from({ length: 10 }, (_, i) =>
      makeRun({ run_id: `r${i}`, started_at: new Date(Date.now() - i * 1000).toISOString() }),
    );
    mockListRuns.mockReturnValue(runs);

    const status = getSystemStatus();
    expect(status.recentRuns).toHaveLength(5);
  });

  it('health score deducted for missing config', () => {
    mockFindConfig.mockReturnValue(null);
    mockListRuns.mockReturnValue([]);
    const status = getSystemStatus();

    expect(status.configFound).toBe(false);
    expect(status.healthScore).toBeLessThan(100);
  });

  it('health score deducted for failures', () => {
    mockFindConfig.mockReturnValue('/path/to/.continuumrc.json');
    mockListRuns.mockReturnValue([
      makeRun({ status: 'failed' }),
      makeRun({ status: 'failed' }),
      makeRun({ status: 'completed' }),
    ]);

    const status = getSystemStatus();
    expect(status.healthScore).toBeLessThan(90);
  });
});

describe('formatStatus', () => {
  it('produces readable output', () => {
    mockListRuns.mockReturnValue([]);
    const status = getSystemStatus();
    const output = formatStatus(status);

    expect(output).toContain('Continuum Status');
    expect(output).toContain('health:');
    expect(output).toContain('Storage:');
  });

  it('shows token usage when present', () => {
    mockListRuns.mockReturnValue([
      makeRun({
        token_usage: { input_tokens: 500, output_tokens: 200, estimated_cost_usd: 0.005 },
      }),
    ]);

    const status = getSystemStatus();
    const output = formatStatus(status);

    expect(output).toContain('Tokens:');
    expect(output).toContain('cost:');
  });
});
