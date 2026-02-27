import { describe, it, expect } from 'vitest';
import { compareRuns, formatComparison } from '../../src/core/run-compare.js';
import type { RunSummary } from '../../src/types/run-summary.js';

function makeRun(overrides: Partial<RunSummary>): RunSummary {
  return {
    run_id: 'run-a',
    task_id: 'task-1',
    prompt: 'test',
    status: 'completed',
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:01:00Z',
    duration_ms: 60000,
    plan: { plan_id: 'p1', steps: [] },
    plan_hash: 'sha256:abc',
    plan_source: 'llm',
    steps: [],
    ...overrides,
  } as RunSummary;
}

describe('compareRuns', () => {
  it('compares two identical runs', () => {
    const a = makeRun({
      run_id: 'r-a',
      steps: [{ step_id: 's1', type: 'create_file', status: 'completed', artifact_hash: 'sha256:aaa' }],
    });
    const b = makeRun({
      run_id: 'r-b',
      steps: [{ step_id: 's1', type: 'create_file', status: 'completed', artifact_hash: 'sha256:aaa' }],
    });

    const cmp = compareRuns(a, b);
    expect(cmp.statusMatch).toBe(true);
    expect(cmp.stepComparisons).toHaveLength(1);
    expect(cmp.stepComparisons[0].statusMatch).toBe(true);
    expect(cmp.stepComparisons[0].hashMatch).toBe(true);
  });

  it('detects status differences', () => {
    const a = makeRun({ run_id: 'r-a', status: 'completed' });
    const b = makeRun({ run_id: 'r-b', status: 'failed' });

    const cmp = compareRuns(a, b);
    expect(cmp.statusMatch).toBe(false);
  });

  it('detects step presence differences', () => {
    const a = makeRun({
      run_id: 'r-a',
      steps: [
        { step_id: 's1', type: 'create_file', status: 'completed' },
        { step_id: 's2', type: 'run_command', status: 'completed' },
      ],
    });
    const b = makeRun({
      run_id: 'r-b',
      steps: [
        { step_id: 's1', type: 'create_file', status: 'completed' },
        { step_id: 's3', type: 'run_command', status: 'completed' },
      ],
    });

    const cmp = compareRuns(a, b);
    expect(cmp.stepComparisons.find((s) => s.presence === 'only_a')?.step_id).toBe('s2');
    expect(cmp.stepComparisons.find((s) => s.presence === 'only_b')?.step_id).toBe('s3');
  });

  it('detects hash divergence', () => {
    const a = makeRun({
      run_id: 'r-a',
      steps: [{ step_id: 's1', type: 'create_file', status: 'completed', artifact_hash: 'sha256:aaa' }],
    });
    const b = makeRun({
      run_id: 'r-b',
      steps: [{ step_id: 's1', type: 'create_file', status: 'completed', artifact_hash: 'sha256:bbb' }],
    });

    const cmp = compareRuns(a, b);
    expect(cmp.stepComparisons[0].hashMatch).toBe(false);
  });

  it('computes duration delta', () => {
    const a = makeRun({ run_id: 'r-a', duration_ms: 1000 });
    const b = makeRun({ run_id: 'r-b', duration_ms: 1500 });

    const cmp = compareRuns(a, b);
    expect(cmp.durationDeltaMs).toBe(500);
  });

  it('computes token delta', () => {
    const a = makeRun({
      run_id: 'r-a',
      token_usage: { input_tokens: 100, output_tokens: 50, estimated_cost_usd: 0.001 },
    });
    const b = makeRun({
      run_id: 'r-b',
      token_usage: { input_tokens: 200, output_tokens: 100, estimated_cost_usd: 0.003 },
    });

    const cmp = compareRuns(a, b);
    expect(cmp.tokenDelta).toBeDefined();
    expect(cmp.tokenDelta!.inputDelta).toBe(100);
    expect(cmp.tokenDelta!.outputDelta).toBe(50);
    expect(cmp.tokenDelta!.costDelta).toBeCloseTo(0.002, 6);
  });

  it('generates readable summary', () => {
    const a = makeRun({
      run_id: 'r-a',
      steps: [{ step_id: 's1', type: 'create_file', status: 'completed', artifact_hash: 'sha256:aaa' }],
    });
    const b = makeRun({
      run_id: 'r-b',
      steps: [{ step_id: 's1', type: 'create_file', status: 'completed', artifact_hash: 'sha256:aaa' }],
    });

    const cmp = compareRuns(a, b);
    expect(cmp.summary).toContain('Same status');
    expect(cmp.summary).toContain('1/1 steps match');
  });
});

describe('formatComparison', () => {
  it('produces readable output', () => {
    const a = makeRun({
      run_id: 'run-aaaa-1111-2222-3333-444444444444',
      steps: [{ step_id: 's1', type: 'create_file', status: 'completed', artifact_hash: 'sha256:aaa' }],
    });
    const b = makeRun({
      run_id: 'run-bbbb-1111-2222-3333-444444444444',
      steps: [{ step_id: 's1', type: 'create_file', status: 'completed', artifact_hash: 'sha256:bbb' }],
    });

    const output = formatComparison(compareRuns(a, b));
    expect(output).toContain('Run Comparison');
    expect(output).toContain('Run A:');
    expect(output).toContain('Run B:');
    expect(output).toContain('Steps:');
  });
});
