import { describe, it, expect } from 'vitest';
import { diffPlans, formatPlanDiff } from '../../src/core/plan-diff.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';

function makePlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    plan_id: 'plan-1',
    description: 'Test plan',
    steps: [
      {
        step_id: 's1',
        type: 'create_file',
        description: 'Create hello.txt',
        path: 'hello.txt',
        content: 'Hello World',
        determinism: 'guaranteed',
      },
      {
        step_id: 's2',
        type: 'run_command',
        description: 'Run test',
        command: 'npm',
        args: ['test'],
        determinism: 'best_effort',
      },
    ],
    ...overrides,
  };
}

describe('diffPlans', () => {
  it('detects identical plans', () => {
    const plan = makePlan();
    const result = diffPlans(plan, plan);

    expect(result.stepsAdded).toEqual([]);
    expect(result.stepsRemoved).toEqual([]);
    expect(result.stepsModified).toEqual([]);
    expect(result.stepsUnchanged).toEqual(['s1', 's2']);
    expect(result.summary).toBe('identical');
    expect(result.planIdChanged).toBe(false);
  });

  it('detects added steps', () => {
    const planA = makePlan();
    const planB = makePlan({
      steps: [
        ...planA.steps,
        {
          step_id: 's3',
          type: 'create_file',
          description: 'Extra file',
          path: 'extra.txt',
          content: 'extra',
          determinism: 'guaranteed',
        },
      ],
    });

    const result = diffPlans(planA, planB);
    expect(result.stepsAdded).toEqual(['s3']);
    expect(result.stepsUnchanged).toEqual(['s1', 's2']);
  });

  it('detects removed steps', () => {
    const planA = makePlan();
    const planB = makePlan({ steps: [planA.steps[0]] });

    const result = diffPlans(planA, planB);
    expect(result.stepsRemoved).toEqual(['s2']);
    expect(result.stepsUnchanged).toEqual(['s1']);
  });

  it('detects modified step fields', () => {
    const planA = makePlan();
    const planB = makePlan({
      steps: [
        {
          ...planA.steps[0],
          type: 'create_file' as const,
          path: 'hello.txt',
          content: 'Updated content',
          determinism: 'guaranteed' as const,
        } as typeof planA.steps[0],
        planA.steps[1],
      ],
    });

    const result = diffPlans(planA, planB);
    expect(result.stepsModified).toEqual(['s1']);

    const s1diff = result.stepDiffs.find((d) => d.stepId === 's1');
    expect(s1diff?.change).toBe('modified');
    expect(s1diff?.fields?.some((f) => f.field === 'content')).toBe(true);
  });

  it('detects plan_id change', () => {
    const planA = makePlan({ plan_id: 'plan-1' });
    const planB = makePlan({ plan_id: 'plan-2' });

    const result = diffPlans(planA, planB);
    expect(result.planIdChanged).toBe(true);
  });

  it('detects description change', () => {
    const planA = makePlan({ description: 'Old description' });
    const planB = makePlan({ description: 'New description' });

    const result = diffPlans(planA, planB);
    expect(result.descriptionChanged).toBe(true);
  });

  it('detects execution_mode change', () => {
    const planA = makePlan({ execution_mode: 'sequential' });
    const planB = makePlan({ execution_mode: 'parallel' });

    const result = diffPlans(planA, planB);
    expect(result.executionModeChanged).toBe(true);
  });

  it('detects command and args changes', () => {
    const planA = makePlan();
    const planB = makePlan({
      steps: [
        planA.steps[0],
        {
          step_id: 's2',
          type: 'run_command',
          description: 'Run test',
          command: 'pnpm',
          args: ['test', '--verbose'],
          determinism: 'best_effort',
        },
      ],
    });

    const result = diffPlans(planA, planB);
    expect(result.stepsModified).toContain('s2');

    const s2diff = result.stepDiffs.find((d) => d.stepId === 's2');
    const fields = s2diff?.fields?.map((f) => f.field);
    expect(fields).toContain('command');
    expect(fields).toContain('args');
  });

  it('detects depends_on changes', () => {
    const planA = makePlan();
    const planB = makePlan({
      steps: [
        planA.steps[0],
        {
          ...planA.steps[1],
          depends_on: ['s1'],
        },
      ],
    });

    const result = diffPlans(planA, planB);
    expect(result.stepsModified).toContain('s2');
  });

  it('detects timeout_ms changes', () => {
    const planA = makePlan();
    const planB = makePlan({
      steps: [
        { ...planA.steps[0], timeout_ms: 5000 },
        planA.steps[1],
      ],
    });

    const result = diffPlans(planA, planB);
    expect(result.stepsModified).toContain('s1');
  });
});

describe('formatPlanDiff', () => {
  it('formats diff as readable string', () => {
    const planA = makePlan();
    const planB = makePlan({
      steps: [
        planA.steps[0],
        {
          step_id: 's2',
          type: 'run_command',
          description: 'Run build',
          command: 'npm',
          args: ['run', 'build'],
          determinism: 'guaranteed',
        },
      ],
    });

    const diff = diffPlans(planA, planB);
    const text = formatPlanDiff(diff);

    expect(text).toContain('Plan diff:');
    expect(text).toContain('~ s2 (modified)');
    expect(text).toContain('description');
  });

  it('reports identical plans', () => {
    const plan = makePlan();
    const diff = diffPlans(plan, plan);
    const text = formatPlanDiff(diff);

    expect(text).toContain('identical');
  });
});
