import { describe, it, expect } from 'vitest';
import {
  LintEngine,
  createDefaultLintEngine,
  emptyPlanRule,
  duplicateStepIdRule,
  missingDependencyRule,
  unsafeCommandRule,
  missingDescriptionRule,
  noTimeoutRule,
  formatLintEngineResult,
} from '../../src/core/lint-engine.js';
import type { LintRule, LintEngineConfig } from '../../src/core/lint-engine.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';

const goodPlan: ExecutionPlan = {
  plan_id: 'good',
  steps: [
    { step_id: 's1', type: 'create_file', description: 'Create config', path: 'config.json', content: '{}', determinism: 'guaranteed' },
    { step_id: 's2', type: 'run_command', description: 'Build', command: 'npm', args: ['build'], determinism: 'best_effort', timeout_ms: 30000 },
  ],
};

describe('LintEngine', () => {
  it('creates empty engine', () => {
    const engine = new LintEngine();
    expect(engine.ruleCount).toBe(0);
  });

  it('registers and unregisters rules', () => {
    const engine = new LintEngine();
    engine.register(emptyPlanRule);
    expect(engine.ruleCount).toBe(1);

    engine.unregister('correctness/empty-plan');
    expect(engine.ruleCount).toBe(0);
  });

  it('creates default engine with built-in rules', () => {
    const engine = createDefaultLintEngine();
    expect(engine.ruleCount).toBe(6);
  });

  it('gets rules by category', () => {
    const engine = createDefaultLintEngine();
    const security = engine.getRulesByCategory('security');
    expect(security.length).toBeGreaterThanOrEqual(1);
    expect(security.every((r) => r.category === 'security')).toBe(true);
  });

  it('passes good plan', () => {
    const engine = createDefaultLintEngine();
    const result = engine.lint(goodPlan);
    expect(result.passed).toBe(true);
    expect(result.errors).toBe(0);
  });

  it('detects empty plan', () => {
    const engine = createDefaultLintEngine();
    const result = engine.lint({ plan_id: 'empty', steps: [] });
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.rule === 'correctness/empty-plan')).toBe(true);
  });

  it('detects duplicate step IDs', () => {
    const engine = createDefaultLintEngine();
    const plan: ExecutionPlan = {
      plan_id: 'dup',
      steps: [
        { step_id: 'same', type: 'create_file', description: 'A', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 'same', type: 'create_file', description: 'B', path: 'b', content: '', determinism: 'guaranteed' },
      ],
    };

    const result = engine.lint(plan);
    expect(result.findings.some((f) => f.rule === 'correctness/duplicate-step-id')).toBe(true);
  });

  it('detects missing dependencies', () => {
    const engine = createDefaultLintEngine();
    const plan: ExecutionPlan = {
      plan_id: 'miss',
      steps: [
        { step_id: 's1', type: 'create_file', description: 'A', path: 'a', content: '', determinism: 'guaranteed', depends_on: ['ghost'] },
      ],
    };

    const result = engine.lint(plan);
    expect(result.findings.some((f) => f.rule === 'correctness/missing-dependency')).toBe(true);
  });

  it('detects unsafe commands', () => {
    const engine = createDefaultLintEngine();
    const plan: ExecutionPlan = {
      plan_id: 'unsafe',
      steps: [
        { step_id: 's1', type: 'run_command', description: 'Remove', command: 'rm', args: ['-rf', '/'], determinism: 'best_effort' },
      ],
    };

    const result = engine.lint(plan);
    expect(result.findings.some((f) => f.rule === 'security/unsafe-command')).toBe(true);
  });

  it('detects missing descriptions', () => {
    const engine = createDefaultLintEngine();
    const plan: ExecutionPlan = {
      plan_id: 'desc',
      steps: [
        { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
      ],
    };

    const result = engine.lint(plan);
    expect(result.findings.some((f) => f.rule === 'style/missing-description')).toBe(true);
  });

  it('detects missing timeouts', () => {
    const engine = createDefaultLintEngine();
    const plan: ExecutionPlan = {
      plan_id: 'notimeout',
      steps: [
        { step_id: 's1', type: 'run_command', description: 'Build', command: 'npm', args: ['build'], determinism: 'best_effort' },
      ],
    };

    const result = engine.lint(plan);
    expect(result.findings.some((f) => f.rule === 'best-practice/no-timeout')).toBe(true);
  });

  it('disables specific rules', () => {
    const engine = createDefaultLintEngine();
    const plan: ExecutionPlan = { plan_id: 'empty', steps: [] };

    const config: LintEngineConfig = { disabledRules: ['correctness/empty-plan'] };
    const result = engine.lint(plan, config);
    expect(result.findings.every((f) => f.rule !== 'correctness/empty-plan')).toBe(true);
    expect(result.rulesSkipped).toBeGreaterThanOrEqual(1);
  });

  it('filters by category', () => {
    const engine = createDefaultLintEngine();
    const plan: ExecutionPlan = {
      plan_id: 'cat',
      steps: [
        { step_id: 's1', type: 'run_command', description: '', command: 'rm', args: [], determinism: 'best_effort' },
      ],
    };

    const config: LintEngineConfig = { enabledCategories: ['security'] };
    const result = engine.lint(plan, config);
    // Only security rules should run
    expect(result.findings.every((f) => f.rule.startsWith('security/'))).toBe(true);
  });

  it('overrides severity', () => {
    const engine = createDefaultLintEngine();
    const plan: ExecutionPlan = {
      plan_id: 'sev',
      steps: [
        { step_id: 's1', type: 'run_command', description: 'Go', command: 'rm', args: [], determinism: 'best_effort' },
      ],
    };

    const config: LintEngineConfig = {
      severityOverrides: { 'security/unsafe-command': 'error' },
    };

    const result = engine.lint(plan, config);
    const finding = result.findings.find((f) => f.rule === 'security/unsafe-command');
    expect(finding?.severity).toBe('error');
  });

  it('supports custom rules', () => {
    const engine = new LintEngine();
    const customRule: LintRule = {
      id: 'custom/no-echo',
      category: 'custom',
      severity: 'warning',
      description: 'Disallow echo commands',
      check: (plan) => plan.steps
        .filter((s) => s.type === 'run_command' && s.command === 'echo')
        .map((s) => ({ rule: 'custom/no-echo', severity: 'warning' as const, message: `echo in ${s.step_id}`, stepId: s.step_id })),
    };

    engine.register(customRule);
    const plan: ExecutionPlan = {
      plan_id: 'echo',
      steps: [
        { step_id: 's1', type: 'run_command', description: 'Echo', command: 'echo', args: ['hi'], determinism: 'guaranteed' },
      ],
    };

    const result = engine.lint(plan);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].rule).toBe('custom/no-echo');
  });

  it('supports auto-fix suggestions', () => {
    const engine = new LintEngine();
    const rule: LintRule = {
      id: 'fix/example',
      category: 'correctness',
      severity: 'warning',
      description: 'Example fixable rule',
      check: () => [{ rule: 'fix/example', severity: 'warning', message: 'Fixable issue' }],
      fix: () => ({ ruleId: 'fix/example', description: 'Auto-fix applied' }),
    };

    engine.register(rule);
    const result = engine.lint({ plan_id: 'x', steps: [{ step_id: 's1', type: 'create_file', description: 'A', path: 'a', content: '', determinism: 'guaranteed' }] });

    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0].description).toBe('Auto-fix applied');
  });

  it('tracks byCategory counts', () => {
    const engine = createDefaultLintEngine();
    const plan: ExecutionPlan = {
      plan_id: 'cats',
      steps: [
        { step_id: 's1', type: 'run_command', description: '', command: 'rm', args: [], determinism: 'best_effort' },
      ],
    };

    const result = engine.lint(plan);
    expect(typeof result.byCategory).toBe('object');
  });
});

describe('formatLintEngineResult', () => {
  it('formats passed result', () => {
    const engine = createDefaultLintEngine();
    const result = engine.lint(goodPlan);
    const output = formatLintEngineResult(result);
    expect(output).toContain('PASSED');
  });

  it('formats failed result', () => {
    const engine = createDefaultLintEngine();
    const result = engine.lint({ plan_id: 'empty', steps: [] });
    const output = formatLintEngineResult(result);
    expect(output).toContain('FAILED');
  });
});
