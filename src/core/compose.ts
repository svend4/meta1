import type { ExecutionPlan, Step, ExecutionPlanV3 } from '../types/execution-plan.js';
import { isPlanV3 } from '../types/execution-plan.js';
import type { Assertion } from '../types/assertion.js';

/** Options for plan composition */
export interface ComposeOptions {
  /** How to handle step_id collisions: 'prefix' adds plan_id prefix, 'error' throws. Default: 'prefix'. */
  conflictStrategy?: 'prefix' | 'error';
  /** ID for the composed plan. Default: 'composed-<timestamp>'. */
  planId?: string;
  /** Description for the composed plan. */
  description?: string;
  /** Make second plan depend on all steps from first plan (sequential composition). Default: false. */
  sequential?: boolean;
}

/** Result of plan composition */
export interface ComposeResult {
  plan: ExecutionPlan;
  renamedSteps: Array<{ original: string; renamed: string; sourcePlan: string }>;
}

/**
 * Compose two or more execution plans into a single plan.
 * Steps from all plans are merged. Step ID collisions are resolved based on conflictStrategy.
 */
export function composePlans(plans: ExecutionPlan[], opts?: ComposeOptions): ComposeResult {
  if (plans.length === 0) {
    throw new Error('At least one plan is required for composition');
  }

  if (plans.length === 1) {
    return { plan: { ...plans[0] }, renamedSteps: [] };
  }

  const strategy = opts?.conflictStrategy ?? 'prefix';
  const planId = opts?.planId ?? `composed-${Date.now()}`;
  const renamedSteps: ComposeResult['renamedSteps'] = [];

  // Collect all step IDs to detect collisions
  const globalIds = new Set<string>();
  const renameMap = new Map<string, string>(); // original → new (per plan)
  const allSteps: Step[] = [];
  const allAssertions: Assertion[] = [];
  let isV3 = false;
  let prevPlanStepIds: string[] = [];

  for (let planIdx = 0; planIdx < plans.length; planIdx++) {
    const plan = plans[planIdx];
    const localRenameMap = new Map<string, string>();

    if (isPlanV3(plan)) {
      isV3 = true;
    }

    for (const step of plan.steps) {
      let newId = step.step_id;

      if (globalIds.has(newId)) {
        if (strategy === 'error') {
          throw new Error(
            `Step ID collision: "${newId}" exists in multiple plans. ` +
            `Use conflictStrategy: 'prefix' to auto-resolve.`,
          );
        }
        // Prefix with plan_id
        newId = `${plan.plan_id}/${step.step_id}`;
        if (globalIds.has(newId)) {
          // Still collides — add plan index
          newId = `${plan.plan_id}-${planIdx}/${step.step_id}`;
        }
        renamedSteps.push({
          original: step.step_id,
          renamed: newId,
          sourcePlan: plan.plan_id,
        });
        localRenameMap.set(step.step_id, newId);
      }

      globalIds.add(newId);
      renameMap.set(`${planIdx}:${step.step_id}`, newId);
    }

    // Build remapped steps
    for (const step of plan.steps) {
      const newId = localRenameMap.get(step.step_id) ?? step.step_id;
      const newDeps = (step.depends_on ?? []).map(
        (dep) => localRenameMap.get(dep) ?? dep,
      );

      // If sequential, make first step of this plan depend on all steps of previous plan
      let extraDeps: string[] = [];
      if (opts?.sequential && planIdx > 0 && (step.depends_on ?? []).length === 0) {
        extraDeps = prevPlanStepIds;
      }

      const finalDeps = [...newDeps, ...extraDeps];

      const newStep: Step = {
        ...step,
        step_id: newId,
        ...(finalDeps.length > 0 ? { depends_on: finalDeps } : {}),
      } as Step;

      allSteps.push(newStep);
    }

    // Collect assertions from v3 plans
    if (isPlanV3(plan) && plan.assertions) {
      for (const assertion of plan.assertions) {
        const newAssertion = { ...assertion };
        // Remap step_id references in assertion specs
        if ('step_id' in newAssertion.spec) {
          const origStepId = (newAssertion.spec as { step_id: string }).step_id;
          const remapped = localRenameMap.get(origStepId);
          if (remapped) {
            newAssertion.spec = { ...newAssertion.spec, step_id: remapped } as typeof newAssertion.spec;
          }
        }
        allAssertions.push(newAssertion);
      }
    }

    // Track step IDs for sequential chaining
    prevPlanStepIds = plan.steps.map(
      (s) => localRenameMap.get(s.step_id) ?? s.step_id,
    );
  }

  const basePlan: ExecutionPlan = {
    plan_id: planId,
    description: opts?.description ?? plans.map((p) => p.description ?? p.plan_id).join(' + '),
    steps: allSteps,
    execution_mode: opts?.sequential ? 'parallel' : (plans[0].execution_mode ?? 'sequential'),
  };

  if (isV3) {
    const v3Plan: ExecutionPlanV3 = {
      ...basePlan,
      version: '3.0',
      assertions: allAssertions.length > 0 ? allAssertions : undefined,
    };
    return { plan: v3Plan, renamedSteps };
  }

  return { plan: basePlan, renamedSteps };
}
