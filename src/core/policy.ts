/**
 * Execution policies — constraints that govern plan execution.
 * Policies are checked before and during execution to enforce
 * limits on steps, time, cost, and other resources.
 */

/** A single policy rule */
export interface PolicyRule {
  name: string;
  /** Human-readable description */
  description: string;
  /** When to check: 'pre' (before run), 'step' (after each step), 'post' (after run) */
  phase: 'pre' | 'step' | 'post';
  /** The check function. Returns violation message or null if ok. */
  check: (ctx: PolicyContext) => string | null;
}

/** Context passed to policy checks */
export interface PolicyContext {
  /** Total steps in the plan */
  totalSteps: number;
  /** Steps completed so far */
  completedSteps: number;
  /** Steps failed so far */
  failedSteps: number;
  /** Elapsed time in ms */
  elapsedMs: number;
  /** Token usage so far */
  inputTokens: number;
  outputTokens: number;
  /** Estimated cost USD */
  estimatedCostUsd: number;
  /** Current step index (for step-phase checks) */
  currentStepIndex?: number;
  /** Execution mode */
  executionMode: string;
}

/** Policy violation result */
export interface PolicyViolation {
  ruleName: string;
  message: string;
  phase: 'pre' | 'step' | 'post';
  /** Whether to abort execution */
  abort: boolean;
}

/** Execution policy configuration */
export interface ExecutionPolicy {
  /** Maximum number of steps allowed */
  maxSteps?: number;
  /** Maximum total execution time in ms */
  maxDurationMs?: number;
  /** Maximum estimated cost in USD */
  maxCostUsd?: number;
  /** Maximum consecutive failures before abort */
  maxConsecutiveFailures?: number;
  /** Maximum total token usage */
  maxTokens?: number;
  /** Abort on first failure */
  abortOnFailure?: boolean;
  /** Custom policy rules */
  customRules?: PolicyRule[];
}

/**
 * Build a list of policy rules from a policy configuration.
 */
export function buildPolicyRules(policy: ExecutionPolicy): PolicyRule[] {
  const rules: PolicyRule[] = [];

  if (policy.maxSteps !== undefined) {
    rules.push({
      name: 'max-steps',
      description: `Maximum ${policy.maxSteps} steps`,
      phase: 'pre',
      check: (ctx) => {
        if (ctx.totalSteps > policy.maxSteps!) {
          return `Plan has ${ctx.totalSteps} steps, exceeding limit of ${policy.maxSteps}`;
        }
        return null;
      },
    });
  }

  if (policy.maxDurationMs !== undefined) {
    rules.push({
      name: 'max-duration',
      description: `Maximum ${policy.maxDurationMs}ms execution time`,
      phase: 'step',
      check: (ctx) => {
        if (ctx.elapsedMs > policy.maxDurationMs!) {
          return `Execution time ${ctx.elapsedMs}ms exceeds limit of ${policy.maxDurationMs}ms`;
        }
        return null;
      },
    });
  }

  if (policy.maxCostUsd !== undefined) {
    rules.push({
      name: 'max-cost',
      description: `Maximum $${policy.maxCostUsd} USD`,
      phase: 'step',
      check: (ctx) => {
        if (ctx.estimatedCostUsd > policy.maxCostUsd!) {
          return `Estimated cost $${ctx.estimatedCostUsd.toFixed(4)} exceeds limit of $${policy.maxCostUsd}`;
        }
        return null;
      },
    });
  }

  if (policy.maxTokens !== undefined) {
    rules.push({
      name: 'max-tokens',
      description: `Maximum ${policy.maxTokens} total tokens`,
      phase: 'step',
      check: (ctx) => {
        const total = ctx.inputTokens + ctx.outputTokens;
        if (total > policy.maxTokens!) {
          return `Token usage ${total} exceeds limit of ${policy.maxTokens}`;
        }
        return null;
      },
    });
  }

  if (policy.abortOnFailure) {
    rules.push({
      name: 'abort-on-failure',
      description: 'Abort execution on first step failure',
      phase: 'step',
      check: (ctx) => {
        if (ctx.failedSteps > 0) {
          return `Step failure detected (abort-on-failure policy)`;
        }
        return null;
      },
    });
  }

  if (policy.maxConsecutiveFailures !== undefined) {
    let consecutiveFailures = 0;
    rules.push({
      name: 'max-consecutive-failures',
      description: `Maximum ${policy.maxConsecutiveFailures} consecutive failures`,
      phase: 'step',
      check: (ctx) => {
        // Reset tracking based on current failure count
        if (ctx.failedSteps > consecutiveFailures) {
          consecutiveFailures++;
        } else {
          consecutiveFailures = 0;
        }
        if (consecutiveFailures >= policy.maxConsecutiveFailures!) {
          return `${consecutiveFailures} consecutive failures exceeds limit of ${policy.maxConsecutiveFailures}`;
        }
        return null;
      },
    });
  }

  if (policy.customRules) {
    rules.push(...policy.customRules);
  }

  return rules;
}

/**
 * Evaluate policies against the current context.
 * Returns violations found.
 */
export function evaluatePolicies(
  rules: PolicyRule[],
  phase: 'pre' | 'step' | 'post',
  ctx: PolicyContext,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  for (const rule of rules) {
    if (rule.phase !== phase) continue;

    const message = rule.check(ctx);
    if (message) {
      violations.push({
        ruleName: rule.name,
        message,
        phase,
        abort: phase === 'pre' || phase === 'step',
      });
    }
  }

  return violations;
}

/**
 * Format policy violations for human-readable output.
 */
export function formatViolations(violations: PolicyViolation[]): string {
  if (violations.length === 0) return 'No policy violations.';

  return violations.map((v) =>
    `[${v.phase.toUpperCase()}] ${v.ruleName}: ${v.message}${v.abort ? ' (ABORT)' : ''}`,
  ).join('\n');
}

/**
 * Describe a policy configuration in human-readable format.
 */
export function describePolicy(policy: ExecutionPolicy): string {
  const rules = buildPolicyRules(policy);
  if (rules.length === 0) return 'No policies configured.';

  return rules.map((r) => `  - ${r.name}: ${r.description}`).join('\n');
}
