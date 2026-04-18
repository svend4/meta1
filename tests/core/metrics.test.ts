import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeMetrics, formatMetrics } from '../../src/core/metrics.js';
import type { RunSummary } from '../../src/types/run-summary.js';

vi.mock('../../src/storage/runs.js', () => ({
  listRunSummaries: vi.fn(),
}));

import { listRunSummaries } from '../../src/storage/runs.js';
const mockList = vi.mocked(listRunSummaries);

function makeRun(overrides: Partial<RunSummary>): RunSummary {
  return {
    run_id: 'run-1',
    task_id: 'task-1',
    prompt: 'test',
    status: 'completed',
    started_at: '2026-01-15T10:00:00Z',
    duration_ms: 5000,
    plan: { plan_id: 'p1', steps: [] },
    plan_hash: 'sha256:abc',
    plan_source: 'llm',
    steps: [],
    ...overrides,
  } as RunSummary;
}

describe('computeMetrics', () => {
  beforeEach(() => {
    mockList.mockReturnValue([
      makeRun({ run_id: 'r1', status: 'completed', duration_ms: 1000, started_at: '2026-01-01T00:00:00Z',
        steps: [
          { step_id: 's1', type: 'create_file', status: 'completed' },
          { step_id: 's2', type: 'run_command', status: 'completed' },
        ],
        token_usage: { input_tokens: 100, output_tokens: 50, estimated_cost_usd: 0.001 },
      }),
      makeRun({ run_id: 'r2', status: 'failed', duration_ms: 2000, started_at: '2026-01-02T00:00:00Z',
        steps: [
          { step_id: 's1', type: 'create_file', status: 'completed' },
          { step_id: 's2', type: 'run_command', status: 'failed', error: 'boom' },
        ],
        token_usage: { input_tokens: 200, output_tokens: 100, estimated_cost_usd: 0.002 },
      }),
      makeRun({ run_id: 'r3', status: 'verified', duration_ms: 3000, started_at: '2026-01-03T00:00:00Z',
        steps: [
          { step_id: 's1', type: 'create_file', status: 'completed' },
        ],
      }),
    ]);
  });

  it('computes total runs', () => {
    const m = computeMetrics();
    expect(m.totalRuns).toBe(3);
  });

  it('computes status counts', () => {
    const m = computeMetrics();
    expect(m.statusCounts['completed']).toBe(1);
    expect(m.statusCounts['failed']).toBe(1);
    expect(m.statusCounts['verified']).toBe(1);
  });

  it('computes success rate', () => {
    const m = computeMetrics();
    // completed + verified = 2/3
    expect(m.successRate).toBeCloseTo(2 / 3, 2);
  });

  it('computes duration stats', () => {
    const m = computeMetrics();
    expect(m.duration).not.toBeNull();
    expect(m.duration!.min).toBe(1000);
    expect(m.duration!.max).toBe(3000);
    expect(m.duration!.avg).toBe(2000);
  });

  it('computes token totals', () => {
    const m = computeMetrics();
    expect(m.tokens).not.toBeNull();
    expect(m.tokens!.totalInput).toBe(300);
    expect(m.tokens!.totalOutput).toBe(150);
    expect(m.tokens!.totalCost).toBeCloseTo(0.003, 6);
  });

  it('computes step stats', () => {
    const m = computeMetrics();
    expect(m.steps.totalExecuted).toBe(5);
    expect(m.steps.totalFailed).toBe(1);
    expect(m.steps.stepFailureRate).toBeCloseTo(0.2, 2);
  });

  it('computes daily activity', () => {
    const m = computeMetrics();
    expect(m.dailyActivity.length).toBe(3);
    expect(m.dailyActivity[0].date).toBe('2026-01-01');
  });

  it('filters by since', () => {
    const m = computeMetrics({ since: '2026-01-02T00:00:00Z' });
    expect(m.totalRuns).toBe(2);
  });

  it('filters by until', () => {
    const m = computeMetrics({ until: '2026-01-02T00:00:00Z' });
    expect(m.totalRuns).toBe(2);
  });

  it('filters by plan source', () => {
    const m = computeMetrics({ planSource: 'llm' });
    expect(m.totalRuns).toBe(3);

    const m2 = computeMetrics({ planSource: 'cache' });
    expect(m2.totalRuns).toBe(0);
  });

  it('handles empty runs', () => {
    mockList.mockReturnValue([]);
    const m = computeMetrics();
    expect(m.totalRuns).toBe(0);
    expect(m.successRate).toBe(0);
    expect(m.duration).toBeNull();
    expect(m.tokens).toBeNull();
  });

  it('computes period', () => {
    const m = computeMetrics();
    expect(m.period!.from).toContain('2026-01-01');
    expect(m.period!.to).toContain('2026-01-03');
  });
});

describe('formatMetrics', () => {
  it('produces readable output', () => {
    mockList.mockReturnValue([
      makeRun({ run_id: 'r1', status: 'completed', duration_ms: 1000 }),
    ]);
    const m = computeMetrics();
    const output = formatMetrics(m);
    expect(output).toContain('Continuum Metrics');
    expect(output).toContain('Total runs: 1');
    expect(output).toContain('Success rate: 100.0%');
  });
});
