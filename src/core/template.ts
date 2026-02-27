import type { ExecutionPlan, Step, CreateFileStep, RunCommandStep } from '../types/execution-plan.js';

/** Regex matching {{variable_name}} patterns */
const TEMPLATE_RE = /\{\{(\w+)\}\}/g;

/**
 * Extract all template variable names from a plan.
 * Returns unique sorted names found in step fields.
 */
export function extractVariables(plan: ExecutionPlan): string[] {
  const vars = new Set<string>();
  for (const step of plan.steps) {
    collectFromString(step.description, vars);
    if (step.type === 'create_file') {
      collectFromString(step.path, vars);
      collectFromString(step.content, vars);
    } else {
      collectFromString(step.command, vars);
      for (const arg of step.args) {
        collectFromString(arg, vars);
      }
    }
  }
  if (plan.description) {
    collectFromString(plan.description, vars);
  }
  return [...vars].sort();
}

function collectFromString(str: string, vars: Set<string>): void {
  let match;
  while ((match = TEMPLATE_RE.exec(str)) !== null) {
    vars.add(match[1]);
  }
}

/**
 * Validate that all required template variables have values.
 * Returns list of missing variable names.
 */
export function validateVariables(
  plan: ExecutionPlan,
  variables: Record<string, string>,
): string[] {
  const required = extractVariables(plan);
  const planDefaults = ('variables' in plan && plan.variables)
    ? plan.variables as Record<string, string>
    : {};
  return required.filter((name) => !(name in variables) && !(name in planDefaults));
}

/**
 * Apply template variable substitution to a plan.
 * Variables in the plan's `variables` field serve as defaults;
 * the provided `variables` map takes precedence.
 * Returns a new plan with all {{var}} patterns replaced.
 */
export function applyTemplate(
  plan: ExecutionPlan,
  variables: Record<string, string>,
): ExecutionPlan {
  const planDefaults = ('variables' in plan && plan.variables)
    ? plan.variables as Record<string, string>
    : {};
  const merged = { ...planDefaults, ...variables };

  const missing = extractVariables(plan).filter((name) => !(name in merged));
  if (missing.length > 0) {
    throw new Error(`Missing template variables: ${missing.join(', ')}`);
  }

  const sub = (str: string): string =>
    str.replace(TEMPLATE_RE, (_, name: string) => merged[name] ?? _);

  const newSteps: Step[] = plan.steps.map((step) => {
    if (step.type === 'create_file') {
      return {
        ...step,
        description: sub(step.description),
        path: sub(step.path),
        content: sub(step.content),
      } satisfies CreateFileStep;
    }
    return {
      ...step,
      description: sub(step.description),
      command: sub(step.command),
      args: step.args.map(sub),
    } satisfies RunCommandStep;
  });

  return {
    ...plan,
    description: plan.description ? sub(plan.description) : plan.description,
    steps: newSteps,
  };
}
