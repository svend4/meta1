import { describe, it, expect } from 'vitest';
import {
  checkConstraints,
  createStrictConstraints,
  createPermissiveConstraints,
  formatConstraintResult,
} from '../../src/core/plan-constraint.js';
import type { PlanConstraint } from '../../src/core/plan-constraint.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';

function makePlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    plan_id: 'test',
    steps: [
      { step_id: 'create-config', type: 'create_file', description: 'Create config file', path: 'config.json', content: '{}', determinism: 'guaranteed' },
      { step_id: 'run-build', type: 'run_command', description: 'Build the project', command: 'npm', args: ['build'], determinism: 'best_effort', depends_on: ['create-config'] },
    ],
    ...overrides,
  };
}

describe('checkConstraints', () => {
  it('passes with no violations', () => {
    const result = checkConstraints(makePlan(), [
      { id: 'max', description: 'Max 10', severity: 'error', check: { type: 'max_steps', limit: 10 } },
    ]);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('detects max_steps violation', () => {
    const result = checkConstraints(makePlan(), [
      { id: 'max', description: 'Max 1', severity: 'error', check: { type: 'max_steps', limit: 1 } },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors).toBe(1);
  });

  it('detects max_file_size violation', () => {
    const plan = makePlan({
      steps: [{ step_id: 's1', type: 'create_file', description: 'Big file', path: 'big.txt', content: 'x'.repeat(100), determinism: 'guaranteed' }],
    });
    const result = checkConstraints(plan, [
      { id: 'size', description: 'Max 50B', severity: 'error', check: { type: 'max_file_size', maxBytes: 50 } },
    ]);
    expect(result.errors).toBe(1);
    expect(result.violations[0].stepId).toBe('s1');
  });

  it('detects forbidden_commands', () => {
    const result = checkConstraints(makePlan(), [
      { id: 'no-npm', description: 'No npm', severity: 'error', check: { type: 'forbidden_commands', commands: ['npm'] } },
    ]);
    expect(result.errors).toBe(1);
  });

  it('detects allowed_commands violation', () => {
    const result = checkConstraints(makePlan(), [
      { id: 'only-echo', description: 'Only echo', severity: 'warning', check: { type: 'allowed_commands', commands: ['echo'] } },
    ]);
    expect(result.warnings).toBe(1);
  });

  it('detects forbidden_paths', () => {
    const plan = makePlan({
      steps: [{ step_id: 's1', type: 'create_file', description: 'Create', path: '/etc/passwd', content: '', determinism: 'guaranteed' }],
    });
    const result = checkConstraints(plan, [
      { id: 'no-etc', description: 'No /etc/', severity: 'error', check: { type: 'forbidden_paths', patterns: ['/etc/**'] } },
    ]);
    expect(result.errors).toBe(1);
  });

  it('detects allowed_paths violation', () => {
    const plan = makePlan({
      steps: [{ step_id: 's1', type: 'create_file', description: 'Create', path: 'outside/file.txt', content: '', determinism: 'guaranteed' }],
    });
    const result = checkConstraints(plan, [
      { id: 'only-src', description: 'Only src/', severity: 'error', check: { type: 'allowed_paths', patterns: ['src/**'] } },
    ]);
    expect(result.errors).toBe(1);
  });

  it('detects missing descriptions', () => {
    const plan = makePlan({
      steps: [{ step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' }],
    });
    const result = checkConstraints(plan, [
      { id: 'desc', description: 'Require desc', severity: 'warning', check: { type: 'require_descriptions', minLength: 5 } },
    ]);
    expect(result.warnings).toBe(1);
  });

  it('detects naming convention violation', () => {
    const plan = makePlan({
      steps: [{ step_id: 'BadName', type: 'create_file', description: 'Create', path: 'a', content: '', determinism: 'guaranteed' }],
    });
    const result = checkConstraints(plan, [
      { id: 'kebab', description: 'Kebab case', severity: 'warning', check: { type: 'naming_convention', pattern: '^[a-z][a-z0-9-]*$' } },
    ]);
    expect(result.warnings).toBe(1);
  });

  it('detects duplicate IDs', () => {
    const plan = makePlan({
      steps: [
        { step_id: 'dup', type: 'create_file', description: 'a', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 'dup', type: 'create_file', description: 'b', path: 'b', content: '', determinism: 'guaranteed' },
      ],
    });
    const result = checkConstraints(plan, [
      { id: 'no-dup', description: 'No dups', severity: 'error', check: { type: 'no_duplicate_ids' } },
    ]);
    expect(result.errors).toBe(1);
  });

  it('checks max_depth', () => {
    const plan = makePlan({
      steps: [
        { step_id: 'a', type: 'create_file', description: 'a', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 'b', type: 'create_file', description: 'b', path: 'b', content: '', determinism: 'guaranteed', depends_on: ['a'] },
        { step_id: 'c', type: 'create_file', description: 'c', path: 'c', content: '', determinism: 'guaranteed', depends_on: ['b'] },
        { step_id: 'd', type: 'create_file', description: 'd', path: 'd', content: '', determinism: 'guaranteed', depends_on: ['c'] },
      ],
    });
    const result = checkConstraints(plan, [
      { id: 'depth', description: 'Max depth 2', severity: 'error', check: { type: 'max_depth', limit: 2 } },
    ]);
    expect(result.errors).toBe(1);
  });

  it('runs custom constraint', () => {
    const constraint: PlanConstraint = {
      id: 'custom',
      description: 'No plan_id starting with test',
      severity: 'error',
      check: { type: 'custom', fn: (plan) => plan.plan_id.startsWith('test') ? 'Plan ID starts with test' : null },
    };
    const result = checkConstraints(makePlan(), [constraint]);
    expect(result.errors).toBe(1);
  });

  it('custom constraint passes', () => {
    const constraint: PlanConstraint = {
      id: 'custom',
      description: 'Always pass',
      severity: 'error',
      check: { type: 'custom', fn: () => null },
    };
    const result = checkConstraints(makePlan(), [constraint]);
    expect(result.valid).toBe(true);
  });
});

describe('constraint presets', () => {
  it('strict constraints validate clean plan', () => {
    const result = checkConstraints(makePlan(), createStrictConstraints());
    expect(result.errors).toBe(0);
  });

  it('permissive constraints validate clean plan', () => {
    const result = checkConstraints(makePlan(), createPermissiveConstraints());
    expect(result.valid).toBe(true);
  });
});

describe('formatConstraintResult', () => {
  it('formats passing result', () => {
    const result = checkConstraints(makePlan(), []);
    const output = formatConstraintResult(result);
    expect(output).toContain('PASSED');
  });

  it('formats failing result', () => {
    const result = checkConstraints(makePlan(), [
      { id: 'max', description: 'Max 1', severity: 'error', check: { type: 'max_steps', limit: 1 } },
    ]);
    const output = formatConstraintResult(result);
    expect(output).toContain('FAILED');
    expect(output).toContain('[E]');
  });
});
