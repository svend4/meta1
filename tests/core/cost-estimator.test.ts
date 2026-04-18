import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  estimateStepCost,
  estimatePlanCost,
  recordTiming,
  loadTimings,
  formatCostEstimate,
} from '../../src/core/cost-estimator.js';
import type { ExecutionPlan, Step } from '../../src/types/execution-plan.js';

let tempDir: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
}));

describe('cost-estimator', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-cost-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('estimates file creation cost by size', () => {
    const step: Step = { step_id: 's1', type: 'create_file', description: 'Create', path: 'big.txt', content: 'x'.repeat(10240), determinism: 'guaranteed' };
    const est = estimateStepCost(step);

    expect(est.basis).toBe('heuristic');
    expect(est.confidence).toBe(0.9);
    expect(est.ioCostBytes).toBe(10240);
    expect(est.estimatedMs).toBeGreaterThan(0);
  });

  it('estimates known command with heuristic', () => {
    const step: Step = { step_id: 's1', type: 'run_command', description: 'Echo', command: 'echo', args: ['hi'], determinism: 'guaranteed' };
    const est = estimateStepCost(step);

    expect(est.basis).toBe('heuristic');
    expect(est.estimatedMs).toBe(10);
    expect(est.confidence).toBe(0.95);
  });

  it('estimates unknown command with default', () => {
    const step: Step = { step_id: 's1', type: 'run_command', description: 'Custom', command: 'my-tool', args: [], determinism: 'best_effort' };
    const est = estimateStepCost(step);

    expect(est.basis).toBe('default');
    expect(est.estimatedMs).toBe(5000);
    expect(est.confidence).toBe(0.1);
  });

  it('uses historical data when available', () => {
    recordTiming('my-tool', 100);
    recordTiming('my-tool', 200);
    recordTiming('my-tool', 300);

    const step: Step = { step_id: 's1', type: 'run_command', description: 'Custom', command: 'my-tool', args: [], determinism: 'best_effort' };
    const est = estimateStepCost(step);

    expect(est.basis).toBe('historical');
    expect(est.estimatedMs).toBe(200);
    expect(est.confidence).toBeGreaterThan(0.5);
  });

  it('records and loads timings', () => {
    recordTiming('npm', 5000);
    recordTiming('npm', 7000);

    const timings = loadTimings();
    expect(timings.get('npm')).toBeDefined();
    expect(timings.get('npm')!.samples).toBe(2);
    expect(timings.get('npm')!.avgMs).toBe(6000);
  });

  it('estimates plan cost with sequential total', () => {
    const plan: ExecutionPlan = {
      plan_id: 'p1',
      steps: [
        { step_id: 's1', type: 'create_file', description: 'a', path: 'a', content: 'x', determinism: 'guaranteed' },
        { step_id: 's2', type: 'run_command', description: 'b', command: 'echo', args: [], determinism: 'guaranteed' },
      ],
    };

    const est = estimatePlanCost(plan);
    expect(est.steps).toHaveLength(2);
    expect(est.totalSequentialMs).toBeGreaterThan(0);
    expect(est.totalIOBytes).toBeGreaterThan(0);
  });

  it('computes parallel critical path', () => {
    const plan: ExecutionPlan = {
      plan_id: 'p1',
      execution_mode: 'parallel',
      steps: [
        { step_id: 'a', type: 'run_command', description: 'A', command: 'echo', args: [], determinism: 'guaranteed' },
        { step_id: 'b', type: 'run_command', description: 'B', command: 'echo', args: [], determinism: 'guaranteed' },
        { step_id: 'c', type: 'run_command', description: 'C', command: 'echo', args: [], determinism: 'guaranteed', depends_on: ['a', 'b'] },
      ],
    };

    const est = estimatePlanCost(plan);
    // Parallel: a+c or b+c (both 20ms), sequential: a+b+c (30ms)
    expect(est.totalParallelMs).toBeLessThanOrEqual(est.totalSequentialMs);
  });

  it('formats cost estimate', () => {
    const plan: ExecutionPlan = {
      plan_id: 'fmt-test',
      steps: [
        { step_id: 's1', type: 'create_file', description: 'a', path: 'a', content: 'x', determinism: 'guaranteed' },
      ],
    };

    const est = estimatePlanCost(plan);
    const output = formatCostEstimate(est);
    expect(output).toContain('Cost Estimate');
    expect(output).toContain('fmt-test');
    expect(output).toContain('Sequential');
  });
});
