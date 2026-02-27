import { describe, it, expect } from 'vitest';
import { planToDot } from '../../src/core/dot-graph.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';

function makePlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    plan_id: 'test-plan',
    steps: [
      { step_id: 's1', type: 'create_file', description: 'Create config', path: 'a.json', content: '{}', determinism: 'guaranteed' },
      { step_id: 's2', type: 'run_command', description: 'Run build', command: 'npm', args: ['build'], determinism: 'best_effort', depends_on: ['s1'] },
    ],
    ...overrides,
  } as ExecutionPlan;
}

describe('planToDot', () => {
  it('generates valid DOT syntax', () => {
    const dot = planToDot(makePlan());
    expect(dot).toContain('digraph');
    expect(dot).toContain('{');
    expect(dot).toContain('}');
  });

  it('includes step nodes', () => {
    const dot = planToDot(makePlan());
    expect(dot).toContain('"s1"');
    expect(dot).toContain('"s2"');
  });

  it('includes edges for dependencies', () => {
    const dot = planToDot(makePlan());
    expect(dot).toContain('"s1" -> "s2"');
  });

  it('colors create_file green and run_command yellow', () => {
    const dot = planToDot(makePlan());
    expect(dot).toContain('#d4edda'); // green fill
    expect(dot).toContain('#fff3cd'); // yellow fill
  });

  it('uses dashed style for best_effort', () => {
    const dot = planToDot(makePlan());
    expect(dot).toContain('dashed');
  });

  it('includes descriptions by default', () => {
    const dot = planToDot(makePlan());
    expect(dot).toContain('Create config');
    expect(dot).toContain('Run build');
  });

  it('hides descriptions when disabled', () => {
    const dot = planToDot(makePlan(), { showDescriptions: false });
    expect(dot).not.toContain('Create config');
  });

  it('uses LR layout when specified', () => {
    const dot = planToDot(makePlan(), { rankdir: 'LR' });
    expect(dot).toContain('rankdir=LR');
  });

  it('uses TB layout by default', () => {
    const dot = planToDot(makePlan());
    expect(dot).toContain('rankdir=TB');
  });

  it('groups parallel steps with same rank', () => {
    const plan = makePlan({
      execution_mode: 'parallel',
      steps: [
        { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 's2', type: 'create_file', description: '', path: 'b', content: '', determinism: 'guaranteed' },
        { step_id: 's3', type: 'run_command', description: '', command: 'echo', args: [], determinism: 'best_effort', depends_on: ['s1', 's2'] },
      ],
    });

    const dot = planToDot(plan);
    expect(dot).toContain('rank=same');
  });

  it('uses custom title', () => {
    const dot = planToDot(makePlan(), { title: 'My Build' });
    expect(dot).toContain('My Build');
  });

  it('handles empty plan', () => {
    const dot = planToDot({ plan_id: 'empty', steps: [] } as ExecutionPlan);
    expect(dot).toContain('digraph');
    expect(dot).toContain('}');
  });
});
