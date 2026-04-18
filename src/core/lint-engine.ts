/**
 * Lint rules engine — pluggable rule registry with custom rules,
 * categories, severity overrides, auto-fix suggestions, and
 * configurable rule sets.
 */

import type { ExecutionPlan } from '../types/execution-plan.js';
import type { LintSeverity, LintFinding } from './lint.js';

/** A lint rule definition */
export interface LintRule {
  /** Unique rule ID (e.g., 'security/unsafe-command') */
  id: string;
  /** Rule category */
  category: RuleCategory;
  /** Default severity */
  severity: LintSeverity;
  /** Human-readable description */
  description: string;
  /** The check function — returns findings */
  check: (plan: ExecutionPlan, context: RuleContext) => LintFinding[];
  /** Optional auto-fix suggestion generator */
  fix?: (plan: ExecutionPlan, finding: LintFinding) => FixSuggestion | null;
}

/** Rule categories */
export type RuleCategory = 'security' | 'performance' | 'correctness' | 'style' | 'best-practice' | 'custom';

/** Context passed to rules during evaluation */
export interface RuleContext {
  /** Severity overrides per rule ID */
  severityOverrides: Record<string, LintSeverity>;
  /** Disabled rule IDs */
  disabledRules: Set<string>;
  /** Custom rule options */
  ruleOptions: Record<string, Record<string, unknown>>;
}

/** An auto-fix suggestion */
export interface FixSuggestion {
  ruleId: string;
  stepId?: string;
  description: string;
  /** The modified plan (if auto-fixable) */
  fixedPlan?: ExecutionPlan;
}

/** Engine configuration */
export interface LintEngineConfig {
  /** Severity overrides (ruleId → severity) */
  severityOverrides?: Record<string, LintSeverity>;
  /** Disabled rules */
  disabledRules?: string[];
  /** Enabled categories (if set, only rules in these categories run) */
  enabledCategories?: RuleCategory[];
  /** Per-rule options */
  ruleOptions?: Record<string, Record<string, unknown>>;
}

/** Result from the engine */
export interface LintEngineResult {
  findings: LintFinding[];
  fixes: FixSuggestion[];
  rulesExecuted: number;
  rulesSkipped: number;
  errors: number;
  warnings: number;
  infos: number;
  passed: boolean;
  byCategory: Record<string, number>;
}

/**
 * Pluggable lint rules engine.
 */
export class LintEngine {
  private rules = new Map<string, LintRule>();

  /**
   * Register a lint rule.
   */
  register(rule: LintRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Unregister a rule by ID.
   */
  unregister(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * Get all registered rules.
   */
  getRules(): LintRule[] {
    return [...this.rules.values()];
  }

  /**
   * Get rules by category.
   */
  getRulesByCategory(category: RuleCategory): LintRule[] {
    return [...this.rules.values()].filter((r) => r.category === category);
  }

  /**
   * Run all applicable rules against a plan.
   */
  lint(plan: ExecutionPlan, config?: LintEngineConfig): LintEngineResult {
    const disabledRules = new Set(config?.disabledRules ?? []);
    const enabledCategories = config?.enabledCategories ? new Set(config.enabledCategories) : null;
    const severityOverrides = config?.severityOverrides ?? {};
    const ruleOptions = config?.ruleOptions ?? {};

    const context: RuleContext = { severityOverrides, disabledRules, ruleOptions };

    const findings: LintFinding[] = [];
    const fixes: FixSuggestion[] = [];
    let rulesExecuted = 0;
    let rulesSkipped = 0;

    for (const rule of this.rules.values()) {
      // Skip disabled rules
      if (disabledRules.has(rule.id)) {
        rulesSkipped++;
        continue;
      }

      // Skip if category not enabled
      if (enabledCategories && !enabledCategories.has(rule.category)) {
        rulesSkipped++;
        continue;
      }

      rulesExecuted++;

      const ruleFindings = rule.check(plan, context);

      for (const finding of ruleFindings) {
        // Apply severity override
        const overriddenSeverity = severityOverrides[rule.id];
        if (overriddenSeverity) {
          finding.severity = overriddenSeverity;
        }

        findings.push(finding);

        // Generate fix suggestion if available
        if (rule.fix) {
          const fix = rule.fix(plan, finding);
          if (fix) fixes.push(fix);
        }
      }
    }

    const errors = findings.filter((f) => f.severity === 'error').length;
    const warnings = findings.filter((f) => f.severity === 'warning').length;
    const infos = findings.filter((f) => f.severity === 'info').length;

    const byCategory: Record<string, number> = {};
    for (const f of findings) {
      const cat = f.rule.split('/')[0] ?? 'unknown';
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }

    return {
      findings,
      fixes,
      rulesExecuted,
      rulesSkipped,
      errors,
      warnings,
      infos,
      passed: errors === 0,
      byCategory,
    };
  }

  /**
   * Get rule count.
   */
  get ruleCount(): number {
    return this.rules.size;
  }
}

// ── Built-in Rules ──

/** Rule: detect empty plan */
export const emptyPlanRule: LintRule = {
  id: 'correctness/empty-plan',
  category: 'correctness',
  severity: 'error',
  description: 'Plan must have at least one step',
  check: (plan) => {
    if (plan.steps.length === 0) {
      return [{ rule: 'correctness/empty-plan', severity: 'error', message: 'Plan has no steps' }];
    }
    return [];
  },
};

/** Rule: detect duplicate step IDs */
export const duplicateStepIdRule: LintRule = {
  id: 'correctness/duplicate-step-id',
  category: 'correctness',
  severity: 'error',
  description: 'Step IDs must be unique',
  check: (plan) => {
    const seen = new Set<string>();
    const findings: LintFinding[] = [];
    for (const step of plan.steps) {
      if (seen.has(step.step_id)) {
        findings.push({
          rule: 'correctness/duplicate-step-id',
          severity: 'error',
          message: `Duplicate step ID: "${step.step_id}"`,
          stepId: step.step_id,
        });
      }
      seen.add(step.step_id);
    }
    return findings;
  },
};

/** Rule: detect missing dependencies */
export const missingDependencyRule: LintRule = {
  id: 'correctness/missing-dependency',
  category: 'correctness',
  severity: 'error',
  description: 'All depends_on references must point to existing steps',
  check: (plan) => {
    const ids = new Set(plan.steps.map((s) => s.step_id));
    const findings: LintFinding[] = [];
    for (const step of plan.steps) {
      for (const dep of step.depends_on ?? []) {
        if (!ids.has(dep)) {
          findings.push({
            rule: 'correctness/missing-dependency',
            severity: 'error',
            message: `Step "${step.step_id}" depends on unknown step "${dep}"`,
            stepId: step.step_id,
          });
        }
      }
    }
    return findings;
  },
};

/** Rule: detect unsafe commands */
export const unsafeCommandRule: LintRule = {
  id: 'security/unsafe-command',
  category: 'security',
  severity: 'warning',
  description: 'Detect potentially dangerous commands',
  check: (plan) => {
    const unsafe = new Set(['rm', 'rmdir', 'del', 'format', 'mkfs', 'dd', 'chmod', 'chown', 'kill', 'shutdown', 'reboot']);
    const findings: LintFinding[] = [];
    for (const step of plan.steps) {
      if (step.type === 'run_command' && unsafe.has(step.command)) {
        findings.push({
          rule: 'security/unsafe-command',
          severity: 'warning',
          message: `Step "${step.step_id}" uses potentially dangerous command "${step.command}"`,
          stepId: step.step_id,
        });
      }
    }
    return findings;
  },
};

/** Rule: detect steps without descriptions */
export const missingDescriptionRule: LintRule = {
  id: 'style/missing-description',
  category: 'style',
  severity: 'info',
  description: 'Steps should have meaningful descriptions',
  check: (plan) => {
    const findings: LintFinding[] = [];
    for (const step of plan.steps) {
      if (!step.description || step.description.trim().length < 3) {
        findings.push({
          rule: 'style/missing-description',
          severity: 'info',
          message: `Step "${step.step_id}" has no meaningful description`,
          stepId: step.step_id,
        });
      }
    }
    return findings;
  },
};

/** Rule: warn about steps without timeouts */
export const noTimeoutRule: LintRule = {
  id: 'best-practice/no-timeout',
  category: 'best-practice',
  severity: 'info',
  description: 'Command steps should have timeouts',
  check: (plan) => {
    const findings: LintFinding[] = [];
    for (const step of plan.steps) {
      if (step.type === 'run_command' && !step.timeout_ms) {
        findings.push({
          rule: 'best-practice/no-timeout',
          severity: 'info',
          message: `Step "${step.step_id}" has no timeout configured`,
          stepId: step.step_id,
        });
      }
    }
    return findings;
  },
};

/**
 * Create a lint engine pre-loaded with built-in rules.
 */
export function createDefaultLintEngine(): LintEngine {
  const engine = new LintEngine();
  engine.register(emptyPlanRule);
  engine.register(duplicateStepIdRule);
  engine.register(missingDependencyRule);
  engine.register(unsafeCommandRule);
  engine.register(missingDescriptionRule);
  engine.register(noTimeoutRule);
  return engine;
}

/**
 * Format lint engine result for display.
 */
export function formatLintEngineResult(result: LintEngineResult): string {
  const lines: string[] = [];
  const status = result.passed ? 'PASSED' : 'FAILED';

  lines.push(`Lint: ${status} (${result.rulesExecuted} rules, ${result.rulesSkipped} skipped)`);
  lines.push(`  ${result.errors} errors, ${result.warnings} warnings, ${result.infos} info`);

  if (result.findings.length > 0) {
    lines.push('');
    for (const f of result.findings) {
      const icon = f.severity === 'error' ? 'E' : f.severity === 'warning' ? 'W' : 'I';
      const step = f.stepId ? ` [${f.stepId}]` : '';
      lines.push(`  [${icon}] ${f.rule}${step}: ${f.message}`);
    }
  }

  if (result.fixes.length > 0) {
    lines.push('');
    lines.push('  Suggested Fixes:');
    for (const fix of result.fixes) {
      lines.push(`    ${fix.ruleId}: ${fix.description}`);
    }
  }

  return lines.join('\n');
}
