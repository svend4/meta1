import { describe, it, expect } from 'vitest';
import {
  buildPolicyRules,
  evaluatePolicies,
  formatViolations,
  describePolicy,
} from '../../src/core/policy.js';
import type { ExecutionPolicy, PolicyContext } from '../../src/core/policy.js';

function makeContext(overrides?: Partial<PolicyContext>): PolicyContext {
  return {
    totalSteps: 5,
    completedSteps: 0,
    failedSteps: 0,
    elapsedMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    executionMode: 'sequential',
    ...overrides,
  };
}

describe('buildPolicyRules', () => {
  it('builds rules from policy config', () => {
    const rules = buildPolicyRules({
      maxSteps: 10,
      maxDurationMs: 60000,
      maxCostUsd: 1.0,
      abortOnFailure: true,
    });
    expect(rules).toHaveLength(4);
    expect(rules.map((r) => r.name)).toEqual([
      'max-steps', 'max-duration', 'max-cost', 'abort-on-failure',
    ]);
  });

  it('returns empty for empty policy', () => {
    expect(buildPolicyRules({})).toHaveLength(0);
  });
});

describe('evaluatePolicies', () => {
  it('passes when within limits', () => {
    const rules = buildPolicyRules({ maxSteps: 10 });
    const violations = evaluatePolicies(rules, 'pre', makeContext({ totalSteps: 5 }));
    expect(violations).toHaveLength(0);
  });

  it('detects max-steps violation', () => {
    const rules = buildPolicyRules({ maxSteps: 3 });
    const violations = evaluatePolicies(rules, 'pre', makeContext({ totalSteps: 5 }));
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleName).toBe('max-steps');
    expect(violations[0].abort).toBe(true);
  });

  it('detects max-duration violation', () => {
    const rules = buildPolicyRules({ maxDurationMs: 30000 });
    const violations = evaluatePolicies(rules, 'step', makeContext({ elapsedMs: 45000 }));
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleName).toBe('max-duration');
  });

  it('detects max-cost violation', () => {
    const rules = buildPolicyRules({ maxCostUsd: 0.50 });
    const violations = evaluatePolicies(rules, 'step', makeContext({ estimatedCostUsd: 0.75 }));
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleName).toBe('max-cost');
  });

  it('detects max-tokens violation', () => {
    const rules = buildPolicyRules({ maxTokens: 10000 });
    const violations = evaluatePolicies(rules, 'step', makeContext({ inputTokens: 8000, outputTokens: 5000 }));
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleName).toBe('max-tokens');
  });

  it('detects abort-on-failure', () => {
    const rules = buildPolicyRules({ abortOnFailure: true });
    const violations = evaluatePolicies(rules, 'step', makeContext({ failedSteps: 1 }));
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleName).toBe('abort-on-failure');
  });

  it('only evaluates rules matching phase', () => {
    const rules = buildPolicyRules({ maxSteps: 3, maxDurationMs: 1000 });
    // maxSteps is 'pre' phase, maxDuration is 'step' phase
    const preViolations = evaluatePolicies(rules, 'pre', makeContext({ totalSteps: 5 }));
    expect(preViolations).toHaveLength(1);
    expect(preViolations[0].ruleName).toBe('max-steps');
  });

  it('supports custom rules', () => {
    const policy: ExecutionPolicy = {
      customRules: [{
        name: 'no-parallel',
        description: 'Disallow parallel execution',
        phase: 'pre',
        check: (ctx) => ctx.executionMode === 'parallel' ? 'Parallel mode not allowed' : null,
      }],
    };

    const rules = buildPolicyRules(policy);
    const violations = evaluatePolicies(rules, 'pre', makeContext({ executionMode: 'parallel' }));
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleName).toBe('no-parallel');
  });
});

describe('formatViolations', () => {
  it('formats violations', () => {
    const rules = buildPolicyRules({ maxSteps: 3 });
    const violations = evaluatePolicies(rules, 'pre', makeContext({ totalSteps: 5 }));
    const formatted = formatViolations(violations);
    expect(formatted).toContain('max-steps');
    expect(formatted).toContain('ABORT');
  });

  it('reports no violations', () => {
    expect(formatViolations([])).toBe('No policy violations.');
  });
});

describe('describePolicy', () => {
  it('describes policy rules', () => {
    const desc = describePolicy({ maxSteps: 10, maxCostUsd: 1.0 });
    expect(desc).toContain('max-steps');
    expect(desc).toContain('max-cost');
  });

  it('reports no policies', () => {
    expect(describePolicy({})).toBe('No policies configured.');
  });
});
