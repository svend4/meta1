import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { analyzePlan, computeLayers } from '../../src/core/dry-run.js';
import type { Step, ExecutionPlanV3 } from '../../src/types/execution-plan.js';

function makeStep(id: string, type: 'create_file' | 'run_command' = 'create_file', deps?: string[]): Step {
  if (type === 'create_file') {
    return {
      step_id: id,
      type: 'create_file',
      description: `Step ${id}`,
      path: `/tmp/${id}.txt`,
      content: id,
      determinism: 'guaranteed',
      depends_on: deps,
    };
  }
  return {
    step_id: id,
    type: 'run_command',
    description: `Run ${id}`,
    command: 'echo',
    args: [id],
    determinism: 'guaranteed',
    depends_on: deps,
  };
}

describe('analyzePlan', () => {
  it('analyzes valid sequential plan', () => {
    const plan = {
      plan_id: randomUUID(),
      steps: [makeStep('s1'), makeStep('s2', 'run_command')],
    };
    const result = analyzePlan(plan);
    expect(result.valid).toBe(true);
    expect(result.total_steps).toBe(2);
    expect(result.files_created).toBe(1);
    expect(result.commands_run).toBe(1);
    expect(result.execution_mode).toBe('sequential');
    expect(result.errors).toHaveLength(0);
  });

  it('analyzes parallel DAG plan with layers', () => {
    const plan = {
      plan_id: randomUUID(),
      execution_mode: 'parallel' as const,
      steps: [
        makeStep('a'),
        makeStep('b'),
        makeStep('c', 'run_command', ['a', 'b']),
      ],
    };
    const result = analyzePlan(plan);
    expect(result.valid).toBe(true);
    expect(result.layers).toBe(2);
    expect(result.steps[0].layer).toBe(0);
    expect(result.steps[1].layer).toBe(0);
    expect(result.steps[2].layer).toBe(1);
  });

  it('rejects invalid plan', () => {
    const result = analyzePlan({ invalid: true });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects cyclic dependencies', () => {
    const plan = {
      plan_id: randomUUID(),
      steps: [
        makeStep('a', 'create_file', ['b']),
        makeStep('b', 'create_file', ['a']),
      ],
    };
    const result = analyzePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/cycle/i);
  });

  it('warns about best_effort steps', () => {
    const plan = {
      plan_id: randomUUID(),
      steps: [{
        step_id: 'be',
        type: 'run_command' as const,
        description: 'Best effort',
        command: 'date',
        args: [],
        determinism: 'best_effort' as const,
      }],
    };
    const result = analyzePlan(plan);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/best_effort/);
  });

  it('warns about depends_on in sequential mode', () => {
    const plan = {
      plan_id: randomUUID(),
      steps: [
        makeStep('a'),
        makeStep('b', 'create_file', ['a']),
      ],
    };
    const result = analyzePlan(plan);
    expect(result.warnings.some((w) => w.includes('sequential'))).toBe(true);
  });

  it('counts assertions in v3 plan', () => {
    const plan: ExecutionPlanV3 = {
      plan_id: randomUUID(),
      version: '3.0',
      steps: [makeStep('s1')],
      assertions: [
        {
          assertion_id: 'a1',
          type: 'file_exists',
          description: 'Check file',
          spec: { type: 'file_exists', path: '/tmp/s1.txt' },
          required: true,
          stability: 'stable',
        },
      ],
    };
    const result = analyzePlan(plan);
    expect(result.assertions_count).toBe(1);
  });
});

describe('computeLayers', () => {
  it('returns empty for no steps', () => {
    expect(computeLayers([])).toEqual([]);
  });

  it('puts independent steps in one layer', () => {
    const steps = [makeStep('a'), makeStep('b'), makeStep('c')];
    const layers = computeLayers(steps);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toHaveLength(3);
  });

  it('creates multiple layers for chain', () => {
    const steps = [
      makeStep('a'),
      makeStep('b', 'create_file', ['a']),
      makeStep('c', 'create_file', ['b']),
    ];
    const layers = computeLayers(steps);
    expect(layers).toHaveLength(3);
    expect(layers[0]).toHaveLength(1);
  });

  it('computes diamond DAG correctly', () => {
    const steps = [
      makeStep('root'),
      makeStep('left', 'create_file', ['root']),
      makeStep('right', 'create_file', ['root']),
      makeStep('join', 'create_file', ['left', 'right']),
    ];
    const layers = computeLayers(steps);
    expect(layers).toHaveLength(3);
    expect(layers[0].map((s) => s.step_id)).toEqual(['root']);
    expect(layers[1].map((s) => s.step_id).sort()).toEqual(['left', 'right']);
    expect(layers[2].map((s) => s.step_id)).toEqual(['join']);
  });
});
