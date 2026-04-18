import type { ExecutionPlan, Step } from '../types/execution-plan.js';

/** A map of alias → step_id */
export type AliasMap = Map<string, string>;

/**
 * Build an alias map from plan steps.
 * Aliases come from the `alias` field on each step.
 */
export function buildAliasMap(steps: Step[]): AliasMap {
  const map: AliasMap = new Map();

  for (const step of steps) {
    const alias = (step as StepWithAlias).alias;
    if (alias) {
      if (map.has(alias)) {
        throw new Error(`Duplicate alias "${alias}" used by steps "${map.get(alias)}" and "${step.step_id}"`);
      }
      // Alias must not collide with an existing step_id
      if (steps.some((s) => s.step_id === alias && s.step_id !== step.step_id)) {
        throw new Error(`Alias "${alias}" on step "${step.step_id}" collides with another step's step_id`);
      }
      map.set(alias, step.step_id);
    }
  }

  return map;
}

/**
 * Resolve depends_on references, replacing aliases with real step_ids.
 * Returns a new plan with resolved dependencies (does not mutate original).
 */
export function resolveAliases(plan: ExecutionPlan): ExecutionPlan {
  const aliasMap = buildAliasMap(plan.steps);
  if (aliasMap.size === 0) return plan;

  const resolvedSteps = plan.steps.map((step) => {
    const deps = step.depends_on;
    if (!deps || deps.length === 0) return step;

    const resolved = deps.map((dep) => aliasMap.get(dep) ?? dep);
    return { ...step, depends_on: resolved };
  });

  return { ...plan, steps: resolvedSteps };
}

/**
 * Get a step by alias or step_id.
 */
export function resolveStepRef(ref: string, steps: Step[]): Step | undefined {
  // Direct match
  const direct = steps.find((s) => s.step_id === ref);
  if (direct) return direct;

  // Alias match
  const aliasMap = buildAliasMap(steps);
  const realId = aliasMap.get(ref);
  if (realId) return steps.find((s) => s.step_id === realId);

  return undefined;
}

/**
 * List all aliases defined in a plan.
 */
export function listAliases(steps: Step[]): Array<{ alias: string; stepId: string; description: string }> {
  const result: Array<{ alias: string; stepId: string; description: string }> = [];

  for (const step of steps) {
    const alias = (step as StepWithAlias).alias;
    if (alias) {
      result.push({
        alias,
        stepId: step.step_id,
        description: step.description ?? '',
      });
    }
  }

  return result;
}

/** Step with optional alias field */
type StepWithAlias = Step & { alias?: string };
