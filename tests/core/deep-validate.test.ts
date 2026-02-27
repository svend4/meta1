import { describe, it, expect } from 'vitest';
import { deepValidatePlan, formatDeepValidation } from '../../src/core/deep-validate.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';

function makePlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    plan_id: 'test',
    steps: [
      { step_id: 's1', type: 'create_file', description: 'Create A', path: 'a.ts', content: '', determinism: 'guaranteed' },
      { step_id: 's2', type: 'run_command', description: 'Build', command: 'npm', args: ['build'], determinism: 'best_effort', depends_on: ['s1'] },
    ],
    ...overrides,
  } as ExecutionPlan;
}

describe('deepValidatePlan', () => {
  it('passes a valid plan', () => {
    const report = deepValidatePlan(makePlan());
    expect(report.passed).toBe(true);
    expect(report.errors).toBe(0);
  });

  it('reports stats', () => {
    const report = deepValidatePlan(makePlan());
    expect(report.stats.totalSteps).toBe(2);
    expect(report.stats.roots).toBe(1);
    expect(report.stats.leaves).toBe(1);
    expect(report.stats.maxDepth).toBe(1);
    expect(report.stats.parallelizable).toBe(1);
  });

  it('detects dependency cycles', () => {
    const plan = makePlan({
      steps: [
        { step_id: 'a', type: 'create_file', description: '', path: 'x', content: '', determinism: 'guaranteed', depends_on: ['b'] },
        { step_id: 'b', type: 'create_file', description: '', path: 'y', content: '', determinism: 'guaranteed', depends_on: ['a'] },
      ],
    });

    const report = deepValidatePlan(plan);
    expect(report.passed).toBe(false);
    const cycleFindings = report.findings.filter((f) => f.rule === 'dependency-cycle');
    expect(cycleFindings.length).toBeGreaterThan(0);
  });

  it('detects orphaned dependencies', () => {
    const plan = makePlan({
      steps: [
        { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed', depends_on: ['ghost'] },
      ],
    });

    const report = deepValidatePlan(plan);
    expect(report.passed).toBe(false);
    expect(report.findings.some((f) => f.rule === 'orphaned-dependency')).toBe(true);
  });

  it('detects write-write conflicts on unordered steps', () => {
    const plan = makePlan({
      execution_mode: 'parallel',
      steps: [
        { step_id: 's1', type: 'create_file', description: '', path: 'same.ts', content: 'a', determinism: 'guaranteed' },
        { step_id: 's2', type: 'create_file', description: '', path: 'same.ts', content: 'b', determinism: 'guaranteed' },
      ],
    });

    const report = deepValidatePlan(plan);
    const conflicts = report.findings.filter((f) => f.rule === 'write-write-conflict');
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('does not report write-write conflict when steps are ordered', () => {
    const plan = makePlan({
      steps: [
        { step_id: 's1', type: 'create_file', description: '', path: 'same.ts', content: 'a', determinism: 'guaranteed' },
        { step_id: 's2', type: 'create_file', description: '', path: 'same.ts', content: 'b', determinism: 'guaranteed', depends_on: ['s1'] },
      ],
    });

    const report = deepValidatePlan(plan);
    const conflicts = report.findings.filter((f) => f.rule === 'write-write-conflict');
    expect(conflicts).toHaveLength(0);
  });

  it('detects unreachable steps in parallel mode', () => {
    const plan = makePlan({
      execution_mode: 'parallel',
      steps: [
        { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 's2', type: 'create_file', description: '', path: 'b', content: '', determinism: 'guaranteed', depends_on: ['ghost-step'] },
      ],
    });

    // s2 depends on ghost-step which doesn't exist, making it unreachable
    const report = deepValidatePlan(plan);
    // Should get orphaned-dependency error
    expect(report.findings.some((f) => f.rule === 'orphaned-dependency')).toBe(true);
  });

  it('detects redundant dependencies', () => {
    const plan = makePlan({
      steps: [
        { step_id: 'a', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 'b', type: 'create_file', description: '', path: 'b', content: '', determinism: 'guaranteed', depends_on: ['a'] },
        { step_id: 'c', type: 'create_file', description: '', path: 'c', content: '', determinism: 'guaranteed', depends_on: ['a', 'b'] },
      ],
    });

    const report = deepValidatePlan(plan);
    const redundant = report.findings.filter((f) => f.rule === 'redundant-dependency');
    expect(redundant.length).toBeGreaterThan(0);
    expect(redundant[0].message).toContain('transitively');
  });

  it('suggests parallelization for independent file steps', () => {
    const plan = makePlan({
      steps: [
        { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 's2', type: 'create_file', description: '', path: 'b', content: '', determinism: 'guaranteed' },
        { step_id: 's3', type: 'create_file', description: '', path: 'c', content: '', determinism: 'guaranteed' },
      ],
    });

    const report = deepValidatePlan(plan);
    expect(report.findings.some((f) => f.rule === 'parallelizable-plan')).toBe(true);
  });

  it('formats report', () => {
    const report = deepValidatePlan(makePlan());
    const formatted = formatDeepValidation(report);
    expect(formatted).toContain('Deep Validation Report');
    expect(formatted).toContain('PASSED');
  });
});
