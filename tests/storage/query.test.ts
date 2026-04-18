import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryRuns, computeRunStats } from '../../src/storage/query.js';
import type { RunSummary } from '../../src/types/run-summary.js';

// Mock the runs module
vi.mock('../../src/storage/runs.js', () => ({
  listRunSummaries: vi.fn(),
}));

import { listRunSummaries } from '../../src/storage/runs.js';
const mockListRuns = vi.mocked(listRunSummaries);

function makeRun(overrides: Partial<RunSummary>): RunSummary {
  return {
    run_id: 'run-1',
    task_id: 'task-1',
    prompt: 'test prompt',
    status: 'completed',
    started_at: '2026-01-15T10:00:00.000Z',
    completed_at: '2026-01-15T10:01:00.000Z',
    duration_ms: 60000,
    plan: { plan_id: 'p1', steps: [] },
    plan_hash: 'sha256:abc',
    plan_source: 'llm',
    steps: [],
    ...overrides,
  } as RunSummary;
}

describe('queryRuns', () => {
  beforeEach(() => {
    mockListRuns.mockReturnValue([
      makeRun({ run_id: 'r1', status: 'completed', started_at: '2026-01-10T10:00:00Z', task_id: 'task-a', plan_source: 'llm', prompt: 'Build API' }),
      makeRun({ run_id: 'r2', status: 'failed', started_at: '2026-01-11T10:00:00Z', task_id: 'task-b', plan_source: 'cache', prompt: 'Fix bug' }),
      makeRun({ run_id: 'r3', status: 'verified', started_at: '2026-01-12T10:00:00Z', task_id: 'task-a', plan_source: 'llm', prompt: 'Build API v2', duration_ms: 120000 }),
      makeRun({ run_id: 'r4', status: 'completed', started_at: '2026-01-13T10:00:00Z', task_id: 'task-c', plan_source: 'file', prompt: 'Deploy service' }),
    ]);
  });

  it('returns all runs with empty query', () => {
    const runs = queryRuns({});
    expect(runs).toHaveLength(4);
  });

  it('filters by status', () => {
    const runs = queryRuns({ status: 'completed' });
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.status === 'completed')).toBe(true);
  });

  it('filters by multiple statuses', () => {
    const runs = queryRuns({ status: ['completed', 'verified'] });
    expect(runs).toHaveLength(3);
  });

  it('filters by taskId', () => {
    const runs = queryRuns({ taskId: 'task-a' });
    expect(runs).toHaveLength(2);
  });

  it('filters by date range', () => {
    const runs = queryRuns({ after: '2026-01-11T00:00:00Z', before: '2026-01-13T00:00:00Z' });
    expect(runs).toHaveLength(2);
  });

  it('filters by planSource', () => {
    const runs = queryRuns({ planSource: 'llm' });
    expect(runs).toHaveLength(2);
  });

  it('filters by prompt text', () => {
    const runs = queryRuns({ promptContains: 'api' });
    expect(runs).toHaveLength(2);
  });

  it('limits results', () => {
    const runs = queryRuns({ limit: 2 });
    expect(runs).toHaveLength(2);
  });

  it('sorts descending by default', () => {
    const runs = queryRuns({});
    expect(runs[0].run_id).toBe('r4');
    expect(runs[3].run_id).toBe('r1');
  });

  it('sorts ascending when requested', () => {
    const runs = queryRuns({ sortOrder: 'asc' });
    expect(runs[0].run_id).toBe('r1');
    expect(runs[3].run_id).toBe('r4');
  });

  it('combines multiple filters', () => {
    const runs = queryRuns({ status: 'completed', planSource: 'llm' });
    expect(runs).toHaveLength(1);
    expect(runs[0].run_id).toBe('r1');
  });

  it('filters by minimum duration', () => {
    const runs = queryRuns({ minDurationMs: 100000 });
    expect(runs).toHaveLength(1);
    expect(runs[0].run_id).toBe('r3');
  });
});

describe('computeRunStats', () => {
  it('computes stats for runs', () => {
    const runs = [
      makeRun({ status: 'completed', duration_ms: 1000 }),
      makeRun({ status: 'completed', duration_ms: 3000 }),
      makeRun({ status: 'failed', duration_ms: 500 }),
    ];

    const stats = computeRunStats(runs);
    expect(stats.totalRuns).toBe(3);
    expect(stats.byStatus['completed']).toBe(2);
    expect(stats.byStatus['failed']).toBe(1);
    expect(stats.avgDurationMs).toBe(1500);
  });

  it('handles empty runs', () => {
    const stats = computeRunStats([]);
    expect(stats.totalRuns).toBe(0);
    expect(stats.avgDurationMs).toBe(0);
    expect(stats.totalTokensInput).toBe(0);
  });

  it('aggregates token usage', () => {
    const runs = [
      makeRun({
        status: 'completed',
        token_usage: { input_tokens: 100, output_tokens: 50, estimated_cost_usd: 0.001 },
      }),
      makeRun({
        status: 'completed',
        token_usage: { input_tokens: 200, output_tokens: 100, estimated_cost_usd: 0.002 },
      }),
    ];

    const stats = computeRunStats(runs);
    expect(stats.totalTokensInput).toBe(300);
    expect(stats.totalTokensOutput).toBe(150);
    expect(stats.totalCostUsd).toBeCloseTo(0.003, 6);
  });
});
