import { describe, it, expect } from 'vitest';
import { optimizePlan, formatOptimization } from '../../src/core/plan-optimizer.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';

function makePlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    plan_id: 'test',
    steps: [],
    ...overrides,
  } as ExecutionPlan;
}

describe('optimizePlan', () => {
  it('returns optimal plan unchanged', () => {
    const plan = makePlan({
      execution_mode: 'parallel',
      steps: [
        { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 's2', type: 'run_command', description: '', command: 'echo', args: [], determinism: 'best_effort', depends_on: ['s1'] },
      ],
    });

    const result = optimizePlan(plan);
    expect(result.optimizations).toHaveLength(0);
  });

  it('removes transitive dependencies', () => {
    const plan = makePlan({
      steps: [
        { step_id: 'a', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 'b', type: 'create_file', description: '', path: 'b', content: '', determinism: 'guaranteed', depends_on: ['a'] },
        { step_id: 'c', type: 'create_file', description: '', path: 'c', content: '', determinism: 'guaranteed', depends_on: ['a', 'b'] },
      ],
    });

    const result = optimizePlan(plan);
    const trans = result.optimizations.find((o) => o.type === 'remove-transitive-deps');
    expect(trans).toBeDefined();
    expect(result.stats.removedDeps).toBeGreaterThan(0);

    // c should no longer directly depend on a (it's transitively through b)
    const stepC = result.plan.steps.find((s) => s.step_id === 'c');
    expect(stepC?.depends_on).not.toContain('a');
    expect(stepC?.depends_on).toContain('b');
  });

  it('suggests parallel mode', () => {
    const plan = makePlan({
      execution_mode: 'sequential',
      steps: [
        { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 's2', type: 'create_file', description: '', path: 'b', content: '', determinism: 'guaranteed' },
      ],
    });

    const result = optimizePlan(plan);
    expect(result.plan.execution_mode).toBe('parallel');
    expect(result.optimizations.some((o) => o.type === 'enable-parallel')).toBe(true);
  });

  it('does not suggest parallel when all steps depend', () => {
    const plan = makePlan({
      steps: [
        { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 's2', type: 'run_command', description: '', command: 'echo', args: [], determinism: 'best_effort', depends_on: ['s1'] },
      ],
    });

    const result = optimizePlan(plan);
    expect(result.optimizations.find((o) => o.type === 'enable-parallel')).toBeUndefined();
  });

  it('reports stats', () => {
    const plan = makePlan({
      steps: [
        { step_id: 'a', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 'b', type: 'create_file', description: '', path: 'b', content: '', determinism: 'guaranteed', depends_on: ['a'] },
        { step_id: 'c', type: 'create_file', description: '', path: 'c', content: '', determinism: 'guaranteed', depends_on: ['a', 'b'] },
      ],
    });

    const result = optimizePlan(plan);
    expect(result.stats.originalLayers).toBeGreaterThanOrEqual(1);
    expect(result.stats.optimizedLayers).toBeGreaterThanOrEqual(1);
  });

  it('handles empty plan', () => {
    const result = optimizePlan(makePlan({ steps: [] }));
    expect(result.optimizations).toHaveLength(0);
    expect(result.stats.originalLayers).toBe(0);
  });

  it('formats optimization result', () => {
    const result = optimizePlan(makePlan({
      steps: [
        { step_id: 'a', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 'b', type: 'create_file', description: '', path: 'b', content: '', determinism: 'guaranteed', depends_on: ['a'] },
        { step_id: 'c', type: 'create_file', description: '', path: 'c', content: '', determinism: 'guaranteed', depends_on: ['a', 'b'] },
      ],
    }));
    const output = formatOptimization(result);
    expect(output).toContain('Plan Optimization Report');
  });
});
