/**
 * Plan constraint checker — declarative constraints on plans that go
 * beyond schema validation: max steps, allowed/forbidden commands,
 * path restrictions, required annotations, naming conventions.
 */

import type { ExecutionPlan, Step } from '../types/execution-plan.js';

/** A constraint rule applied to a plan */
export interface PlanConstraint {
  /** Unique constraint ID */
  id: string;
  /** Human-readable description */
  description: string;
  /** Severity: error blocks execution, warning is advisory */
  severity: 'error' | 'warning';
  /** The constraint check */
  check: ConstraintCheck;
}

/** Types of constraint checks */
export type ConstraintCheck =
  | { type: 'max_steps'; limit: number }
  | { type: 'max_file_size'; maxBytes: number }
  | { type: 'allowed_commands'; commands: string[] }
  | { type: 'forbidden_commands'; commands: string[] }
  | { type: 'allowed_paths'; patterns: string[] }
  | { type: 'forbidden_paths'; patterns: string[] }
  | { type: 'require_descriptions'; minLength?: number }
  | { type: 'require_depends_on' }
  | { type: 'naming_convention'; pattern: string }
  | { type: 'max_depth'; limit: number }
  | { type: 'no_duplicate_ids' }
  | { type: 'custom'; fn: (plan: ExecutionPlan) => string | null };

/** Result of checking a constraint */
export interface ConstraintViolation {
  constraintId: string;
  description: string;
  severity: 'error' | 'warning';
  detail: string;
  stepId?: string;
}

/** Full constraint check result */
export interface ConstraintResult {
  valid: boolean;
  violations: ConstraintViolation[];
  errors: number;
  warnings: number;
}

/**
 * Check a plan against a set of constraints.
 */
export function checkConstraints(
  plan: ExecutionPlan,
  constraints: PlanConstraint[],
): ConstraintResult {
  const violations: ConstraintViolation[] = [];

  for (const constraint of constraints) {
    const found = evaluateConstraint(plan, constraint);
    violations.push(...found);
  }

  const errors = violations.filter((v) => v.severity === 'error').length;
  const warnings = violations.filter((v) => v.severity === 'warning').length;

  return {
    valid: errors === 0,
    violations,
    errors,
    warnings,
  };
}

/**
 * Create common constraint presets.
 */
export function createStrictConstraints(): PlanConstraint[] {
  return [
    { id: 'no-dup-ids', description: 'No duplicate step IDs', severity: 'error', check: { type: 'no_duplicate_ids' } },
    { id: 'require-desc', description: 'Steps must have descriptions', severity: 'error', check: { type: 'require_descriptions', minLength: 5 } },
    { id: 'max-steps-50', description: 'Max 50 steps per plan', severity: 'error', check: { type: 'max_steps', limit: 50 } },
    { id: 'max-file-1mb', description: 'Max 1MB per file', severity: 'error', check: { type: 'max_file_size', maxBytes: 1024 * 1024 } },
    { id: 'no-rm-rf', description: 'Forbid rm -rf', severity: 'error', check: { type: 'forbidden_commands', commands: ['rm'] } },
    { id: 'naming', description: 'Step IDs must be kebab-case', severity: 'warning', check: { type: 'naming_convention', pattern: '^[a-z][a-z0-9-]*$' } },
  ];
}

/**
 * Create permissive constraint presets.
 */
export function createPermissiveConstraints(): PlanConstraint[] {
  return [
    { id: 'no-dup-ids', description: 'No duplicate step IDs', severity: 'error', check: { type: 'no_duplicate_ids' } },
    { id: 'max-steps-200', description: 'Max 200 steps per plan', severity: 'warning', check: { type: 'max_steps', limit: 200 } },
    { id: 'max-file-10mb', description: 'Max 10MB per file', severity: 'warning', check: { type: 'max_file_size', maxBytes: 10 * 1024 * 1024 } },
  ];
}

/**
 * Format constraint result for display.
 */
export function formatConstraintResult(result: ConstraintResult): string {
  const lines: string[] = [];

  lines.push(`Constraints: ${result.valid ? 'PASSED' : 'FAILED'}  (${result.errors} errors, ${result.warnings} warnings)`);

  if (result.violations.length === 0) {
    lines.push('  All constraints satisfied.');
  } else {
    for (const v of result.violations) {
      const icon = v.severity === 'error' ? 'E' : 'W';
      const step = v.stepId ? ` [${v.stepId}]` : '';
      lines.push(`  [${icon}] ${v.description}${step}: ${v.detail}`);
    }
  }

  return lines.join('\n');
}

// ── Internal ──

function evaluateConstraint(plan: ExecutionPlan, constraint: PlanConstraint): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const c = constraint.check;

  switch (c.type) {
    case 'max_steps':
      if (plan.steps.length > c.limit) {
        violations.push(violation(constraint, `Plan has ${plan.steps.length} steps (max ${c.limit})`));
      }
      break;

    case 'max_file_size':
      for (const step of plan.steps) {
        if (step.type === 'create_file') {
          const size = Buffer.byteLength(step.content, 'utf8');
          if (size > c.maxBytes) {
            violations.push(violation(constraint, `File ${step.path} is ${size} bytes (max ${c.maxBytes})`, step.step_id));
          }
        }
      }
      break;

    case 'allowed_commands':
      for (const step of plan.steps) {
        if (step.type === 'run_command' && !c.commands.includes(step.command)) {
          violations.push(violation(constraint, `Command "${step.command}" not in allowed list`, step.step_id));
        }
      }
      break;

    case 'forbidden_commands':
      for (const step of plan.steps) {
        if (step.type === 'run_command' && c.commands.includes(step.command)) {
          violations.push(violation(constraint, `Command "${step.command}" is forbidden`, step.step_id));
        }
      }
      break;

    case 'allowed_paths':
      for (const step of plan.steps) {
        if (step.type === 'create_file') {
          const allowed = c.patterns.some((p) => matchPath(step.path, p));
          if (!allowed) {
            violations.push(violation(constraint, `Path "${step.path}" not in allowed patterns`, step.step_id));
          }
        }
      }
      break;

    case 'forbidden_paths':
      for (const step of plan.steps) {
        if (step.type === 'create_file') {
          const forbidden = c.patterns.some((p) => matchPath(step.path, p));
          if (forbidden) {
            violations.push(violation(constraint, `Path "${step.path}" matches forbidden pattern`, step.step_id));
          }
        }
      }
      break;

    case 'require_descriptions': {
      const minLen = c.minLength ?? 1;
      for (const step of plan.steps) {
        if (!step.description || step.description.length < minLen) {
          violations.push(violation(constraint, `Description too short (min ${minLen} chars)`, step.step_id));
        }
      }
      break;
    }

    case 'require_depends_on':
      for (let i = 1; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        if (!step.depends_on || step.depends_on.length === 0) {
          violations.push(violation(constraint, `Step has no depends_on declared`, step.step_id));
        }
      }
      break;

    case 'naming_convention': {
      const re = new RegExp(c.pattern);
      for (const step of plan.steps) {
        if (!re.test(step.step_id)) {
          violations.push(violation(constraint, `Step ID "${step.step_id}" doesn't match pattern ${c.pattern}`, step.step_id));
        }
      }
      break;
    }

    case 'max_depth': {
      const depth = computeMaxDepth(plan.steps);
      if (depth > c.limit) {
        violations.push(violation(constraint, `Dependency chain depth ${depth} exceeds limit ${c.limit}`));
      }
      break;
    }

    case 'no_duplicate_ids': {
      const ids = new Set<string>();
      for (const step of plan.steps) {
        if (ids.has(step.step_id)) {
          violations.push(violation(constraint, `Duplicate step ID: "${step.step_id}"`, step.step_id));
        }
        ids.add(step.step_id);
      }
      break;
    }

    case 'custom': {
      const msg = c.fn(plan);
      if (msg) {
        violations.push(violation(constraint, msg));
      }
      break;
    }
  }

  return violations;
}

function violation(constraint: PlanConstraint, detail: string, stepId?: string): ConstraintViolation {
  return {
    constraintId: constraint.id,
    description: constraint.description,
    severity: constraint.severity,
    detail,
    stepId,
  };
}

function matchPath(path: string, pattern: string): boolean {
  // Simple glob: support * and ** at end
  if (pattern.endsWith('**')) {
    return path.startsWith(pattern.slice(0, -2));
  }
  if (pattern.endsWith('*')) {
    const dir = pattern.slice(0, -1);
    return path.startsWith(dir) && !path.slice(dir.length).includes('/');
  }
  return path === pattern;
}

function computeMaxDepth(steps: Step[]): number {
  const depthCache = new Map<string, number>();
  const stepMap = new Map(steps.map((s) => [s.step_id, s]));

  function getDepth(id: string): number {
    if (depthCache.has(id)) return depthCache.get(id)!;
    const step = stepMap.get(id);
    if (!step || !step.depends_on?.length) {
      depthCache.set(id, 0);
      return 0;
    }
    const maxParent = Math.max(...step.depends_on.map((d) => getDepth(d)));
    const depth = maxParent + 1;
    depthCache.set(id, depth);
    return depth;
  }

  let max = 0;
  for (const step of steps) {
    max = Math.max(max, getDepth(step.step_id));
  }
  return max;
}
