import { describe, it, expect } from 'vitest';
import { composePlans } from '../../src/core/compose.js';
import type { ExecutionPlan, ExecutionPlanV3 } from '../../src/types/execution-plan.js';

function makePlanA(): ExecutionPlan {
  return {
    plan_id: 'plan-a',
    description: 'Plan A',
    steps: [
      {
        step_id: 'a1',
        type: 'create_file',
        description: 'Create file A',
        path: 'a.txt',
        content: 'A',
        determinism: 'guaranteed',
      },
      {
        step_id: 'a2',
        type: 'run_command',
        description: 'Run A',
        command: 'echo',
        args: ['A'],
        determinism: 'best_effort',
        depends_on: ['a1'],
      },
    ],
  };
}

function makePlanB(): ExecutionPlan {
  return {
    plan_id: 'plan-b',
    description: 'Plan B',
    steps: [
      {
        step_id: 'b1',
        type: 'run_command',
        description: 'Run B',
        command: 'echo',
        args: ['B'],
        determinism: 'guaranteed',
      },
    ],
  };
}

function makeV3Plan(): ExecutionPlanV3 {
  return {
    plan_id: 'plan-v3',
    version: '3.0',
    steps: [
      {
        step_id: 'v1',
        type: 'run_command',
        description: 'V3 step',
        command: 'test',
        args: [],
        determinism: 'best_effort',
      },
    ],
    assertions: [
      {
        assertion_id: 'assert1',
        type: 'exit_code',
        description: 'Check exit',
        required: true,
        stability: 'stable',
        spec: { type: 'exit_code', step_id: 'v1', expected: 0 },
      },
    ],
  };
}

describe('composePlans', () => {
  it('composes two plans without collisions', () => {
    const result = composePlans([makePlanA(), makePlanB()]);

    expect(result.plan.steps).toHaveLength(3);
    expect(result.renamedSteps).toHaveLength(0);
    expect(result.plan.steps.map((s) => s.step_id)).toEqual(['a1', 'a2', 'b1']);
  });

  it('preserves internal dependencies', () => {
    const result = composePlans([makePlanA(), makePlanB()]);
    const a2 = result.plan.steps.find((s) => s.step_id === 'a2');
    expect(a2!.depends_on).toEqual(['a1']);
  });

  it('generates composed description', () => {
    const result = composePlans([makePlanA(), makePlanB()]);
    expect(result.plan.description).toContain('Plan A');
    expect(result.plan.description).toContain('Plan B');
  });

  it('accepts custom plan ID', () => {
    const result = composePlans([makePlanA(), makePlanB()], {
      planId: 'custom-id',
    });
    expect(result.plan.plan_id).toBe('custom-id');
  });

  it('handles step ID collisions with prefix strategy', () => {
    const planA = makePlanA();
    const planC: ExecutionPlan = {
      plan_id: 'plan-c',
      steps: [
        {
          step_id: 'a1', // collides with planA
          type: 'run_command',
          description: 'Colliding step',
          command: 'echo',
          args: ['C'],
          determinism: 'best_effort',
        },
      ],
    };

    const result = composePlans([planA, planC]);
    expect(result.renamedSteps).toHaveLength(1);
    expect(result.renamedSteps[0].original).toBe('a1');
    expect(result.renamedSteps[0].renamed).toBe('plan-c/a1');
    expect(result.plan.steps.map((s) => s.step_id)).toContain('plan-c/a1');
  });

  it('throws on collision with error strategy', () => {
    const planA = makePlanA();
    const planC: ExecutionPlan = {
      plan_id: 'plan-c',
      steps: [
        {
          step_id: 'a1',
          type: 'run_command',
          description: 'Colliding',
          command: 'echo',
          args: [],
          determinism: 'best_effort',
        },
      ],
    };

    expect(() => composePlans([planA, planC], { conflictStrategy: 'error' })).toThrow(
      'Step ID collision',
    );
  });

  it('sequential composition adds cross-plan dependencies', () => {
    const result = composePlans([makePlanA(), makePlanB()], { sequential: true });

    const b1 = result.plan.steps.find((s) => s.step_id === 'b1');
    // b1 should depend on all steps from planA
    expect(b1!.depends_on).toContain('a1');
    expect(b1!.depends_on).toContain('a2');
  });

  it('merges assertions from v3 plans', () => {
    const result = composePlans([makePlanA(), makeV3Plan()]);
    const v3Result = result.plan as ExecutionPlanV3;

    expect(v3Result.version).toBe('3.0');
    expect(v3Result.assertions).toHaveLength(1);
    expect(v3Result.assertions![0].assertion_id).toBe('assert1');
  });

  it('returns single plan unchanged', () => {
    const result = composePlans([makePlanA()]);
    expect(result.plan.plan_id).toBe('plan-a');
    expect(result.plan.steps).toHaveLength(2);
  });

  it('throws for empty plans array', () => {
    expect(() => composePlans([])).toThrow('At least one plan');
  });

  it('supports three-way composition', () => {
    const planC: ExecutionPlan = {
      plan_id: 'plan-c',
      steps: [{ step_id: 'c1', type: 'run_command', description: 'C', command: 'c', args: [], determinism: 'best_effort' }],
    };

    const result = composePlans([makePlanA(), makePlanB(), planC]);
    expect(result.plan.steps).toHaveLength(4);
    expect(result.plan.steps.map((s) => s.step_id)).toEqual(['a1', 'a2', 'b1', 'c1']);
  });
});
