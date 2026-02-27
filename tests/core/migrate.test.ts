import { describe, it, expect } from 'vitest';
import { migratePlan, needsMigration, migrationWarnings } from '../../src/core/migrate.js';
import type { ExecutionPlan, ExecutionPlanV3 } from '../../src/types/execution-plan.js';

function makeV21Plan(): ExecutionPlan {
  return {
    plan_id: 'old-plan',
    description: 'Legacy plan',
    steps: [
      {
        step_id: 's1',
        type: 'create_file',
        description: 'Create file',
        path: 'hello.txt',
        content: 'hello',
        determinism: 'guaranteed',
      },
      {
        step_id: 's2',
        type: 'run_command',
        description: 'Run test',
        command: 'echo',
        args: ['ok'],
        determinism: 'best_effort',
      },
    ],
  };
}

function makeV30Plan(): ExecutionPlanV3 {
  return {
    ...makeV21Plan(),
    version: '3.0',
    assertions: [
      {
        assertion_id: 'a1',
        type: 'exit_code',
        description: 'Check exit code',
        required: true,
        stability: 'stable',
        spec: { type: 'exit_code', step_id: 's2', expected: 0 },
      },
    ],
  };
}

describe('needsMigration', () => {
  it('returns true for v2.1 plans', () => {
    expect(needsMigration(makeV21Plan())).toBe(true);
  });

  it('returns false for v3.0 plans', () => {
    expect(needsMigration(makeV30Plan())).toBe(false);
  });
});

describe('migratePlan', () => {
  it('migrates v2.1 plan to v3.0', () => {
    const old = makeV21Plan();
    const migrated = migratePlan(old);

    expect(migrated.version).toBe('3.0');
    expect(migrated.plan_id).toBe('old-plan');
    expect(migrated.steps).toEqual(old.steps);
    expect(migrated.assertions).toEqual([]);
  });

  it('preserves all original fields', () => {
    const old = makeV21Plan();
    old.execution_mode = 'parallel';
    old.planner_signature = {
      planner_model: 'test-model',
      system_prompt_hash: 'sha256:abc' as `sha256:${string}`,
      generated_at: '2025-01-01T00:00:00Z',
    };

    const migrated = migratePlan(old);
    expect(migrated.execution_mode).toBe('parallel');
    expect(migrated.planner_signature?.planner_model).toBe('test-model');
  });

  it('returns copy of v3.0 plan unchanged', () => {
    const v3 = makeV30Plan();
    const result = migratePlan(v3);

    expect(result.version).toBe('3.0');
    expect(result.assertions).toEqual(v3.assertions);
    expect(result).not.toBe(v3); // shallow copy
  });
});

describe('migrationWarnings', () => {
  it('warns about missing assertions', () => {
    const plan = migratePlan(makeV21Plan());
    const warnings = migrationWarnings(plan);
    expect(warnings.some((w) => w.includes('assertion'))).toBe(true);
  });

  it('warns about missing protected_surface', () => {
    const plan = migratePlan(makeV21Plan());
    const warnings = migrationWarnings(plan);
    expect(warnings.some((w) => w.includes('protected_surface'))).toBe(true);
  });

  it('warns about missing plan_signature', () => {
    const plan = migratePlan(makeV21Plan());
    const warnings = migrationWarnings(plan);
    expect(warnings.some((w) => w.includes('plan_signature'))).toBe(true);
  });

  it('has no assertion warning for plan with assertions', () => {
    const plan = makeV30Plan();
    const warnings = migrationWarnings(plan);
    expect(warnings.some((w) => w.includes('No assertions'))).toBe(false);
  });
});
