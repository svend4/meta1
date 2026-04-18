import { describe, it, expect } from 'vitest';
import { mergePlans, formatMergeResult } from '../../src/core/plan-merge.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';

function makePlan(id: string, steps: ExecutionPlan['steps']): ExecutionPlan {
  return { plan_id: id, steps };
}

const baseSteps: ExecutionPlan['steps'] = [
  { step_id: 's1', type: 'create_file', description: 'Config', path: 'config.json', content: '{}', determinism: 'guaranteed' },
  { step_id: 's2', type: 'run_command', description: 'Build', command: 'npm', args: ['build'], determinism: 'best_effort' },
];

describe('mergePlans', () => {
  it('merges identical plans', () => {
    const base = makePlan('base', baseSteps);
    const result = mergePlans(base, base, base);

    expect(result.success).toBe(true);
    expect(result.plan!.steps).toHaveLength(2);
    expect(result.conflicts).toHaveLength(0);
  });

  it('detects step added in ours only', () => {
    const base = makePlan('base', baseSteps);
    const ours = makePlan('ours', [
      ...baseSteps,
      { step_id: 's3', type: 'run_command', description: 'Test', command: 'npm', args: ['test'], determinism: 'best_effort' },
    ]);
    const theirs = makePlan('theirs', baseSteps);

    const result = mergePlans(base, ours, theirs);
    expect(result.success).toBe(true);
    expect(result.addedOurs).toContain('s3');
    expect(result.plan!.steps).toHaveLength(3);
  });

  it('detects step added in theirs only', () => {
    const base = makePlan('base', baseSteps);
    const ours = makePlan('ours', baseSteps);
    const theirs = makePlan('theirs', [
      ...baseSteps,
      { step_id: 's3', type: 'run_command', description: 'Lint', command: 'npm', args: ['lint'], determinism: 'best_effort' },
    ]);

    const result = mergePlans(base, ours, theirs);
    expect(result.success).toBe(true);
    expect(result.addedTheirs).toContain('s3');
  });

  it('merges both additions without conflict', () => {
    const base = makePlan('base', baseSteps);
    const ours = makePlan('ours', [
      ...baseSteps,
      { step_id: 'test', type: 'run_command', description: 'Test', command: 'npm', args: ['test'], determinism: 'best_effort' },
    ]);
    const theirs = makePlan('theirs', [
      ...baseSteps,
      { step_id: 'lint', type: 'run_command', description: 'Lint', command: 'npm', args: ['lint'], determinism: 'best_effort' },
    ]);

    const result = mergePlans(base, ours, theirs);
    expect(result.success).toBe(true);
    expect(result.plan!.steps).toHaveLength(4);
  });

  it('detects step removed in ours', () => {
    const base = makePlan('base', baseSteps);
    const ours = makePlan('ours', [baseSteps[0]]);
    const theirs = makePlan('theirs', baseSteps);

    const result = mergePlans(base, ours, theirs);
    expect(result.success).toBe(true);
    expect(result.removedOurs).toContain('s2');
  });

  it('detects step removed in both', () => {
    const base = makePlan('base', baseSteps);
    const ours = makePlan('ours', [baseSteps[0]]);
    const theirs = makePlan('theirs', [baseSteps[0]]);

    const result = mergePlans(base, ours, theirs);
    expect(result.success).toBe(true);
    expect(result.plan!.steps).toHaveLength(1);
  });

  it('merges ours-only modification', () => {
    const base = makePlan('base', baseSteps);
    const ours = makePlan('ours', [
      { ...baseSteps[0], description: 'Updated config' },
      baseSteps[1],
    ]);
    const theirs = makePlan('theirs', baseSteps);

    const result = mergePlans(base, ours, theirs);
    expect(result.success).toBe(true);
    expect(result.modified).toContain('s1');
    expect(result.plan!.steps[0].description).toBe('Updated config');
  });

  it('merges theirs-only modification', () => {
    const base = makePlan('base', baseSteps);
    const ours = makePlan('ours', baseSteps);
    const theirs = makePlan('theirs', [
      baseSteps[0],
      { ...baseSteps[1], description: 'New build' },
    ]);

    const result = mergePlans(base, ours, theirs);
    expect(result.success).toBe(true);
    expect(result.plan!.steps[1].description).toBe('New build');
  });

  it('detects conflict on both modifying same field', () => {
    const base = makePlan('base', baseSteps);
    const ours = makePlan('ours', [
      { ...baseSteps[0], description: 'Ours' },
      baseSteps[1],
    ]);
    const theirs = makePlan('theirs', [
      { ...baseSteps[0], description: 'Theirs' },
      baseSteps[1],
    ]);

    const result = mergePlans(base, ours, theirs, { strategy: 'fail' });
    expect(result.success).toBe(false);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it('resolves conflicts with ours strategy', () => {
    const base = makePlan('base', baseSteps);
    const ours = makePlan('ours', [{ ...baseSteps[0], description: 'Ours' }, baseSteps[1]]);
    const theirs = makePlan('theirs', [{ ...baseSteps[0], description: 'Theirs' }, baseSteps[1]]);

    const result = mergePlans(base, ours, theirs, { strategy: 'ours' });
    expect(result.plan).toBeDefined();
    expect(result.plan!.steps[0].description).toBe('Ours');
  });

  it('resolves conflicts with theirs strategy', () => {
    const base = makePlan('base', baseSteps);
    const ours = makePlan('ours', [{ ...baseSteps[0], description: 'Ours' }, baseSteps[1]]);
    const theirs = makePlan('theirs', [{ ...baseSteps[0], description: 'Theirs' }, baseSteps[1]]);

    const result = mergePlans(base, ours, theirs, { strategy: 'theirs' });
    expect(result.plan).toBeDefined();
    expect(result.plan!.steps[0].description).toBe('Theirs');
  });

  it('handles delete/modify conflict with ours strategy', () => {
    const base = makePlan('base', baseSteps);
    const ours = makePlan('ours', [baseSteps[0]]); // Removed s2
    const theirs = makePlan('theirs', [baseSteps[0], { ...baseSteps[1], description: 'Modified' }]); // Modified s2

    const result = mergePlans(base, ours, theirs, { strategy: 'ours' });
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.plan!.steps).toHaveLength(1); // Ours wins: deleted
  });

  it('sets custom plan ID', () => {
    const base = makePlan('base', baseSteps);
    const result = mergePlans(base, base, base, { planId: 'merged-custom' });
    expect(result.plan!.plan_id).toBe('merged-custom');
  });
});

describe('formatMergeResult', () => {
  it('formats clean merge', () => {
    const base = makePlan('base', baseSteps);
    const result = mergePlans(base, base, base);
    const output = formatMergeResult(result);
    expect(output).toContain('MERGED');
  });

  it('formats conflicted merge', () => {
    const base = makePlan('base', baseSteps);
    const ours = makePlan('ours', [{ ...baseSteps[0], description: 'A' }, baseSteps[1]]);
    const theirs = makePlan('theirs', [{ ...baseSteps[0], description: 'B' }, baseSteps[1]]);

    const result = mergePlans(base, ours, theirs, { strategy: 'fail' });
    const output = formatMergeResult(result);
    expect(output).toContain('CONFLICTS');
  });
});
