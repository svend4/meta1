import type { ExecutionPlan, ExecutionPlanV3 } from '../types/execution-plan.js';
import { isPlanV3 } from '../types/execution-plan.js';

/**
 * Migrate a v2.1 plan to v3.0 format.
 * If already v3.0, returns a shallow copy unchanged.
 *
 * Migration adds:
 *   - version: '3.0'
 *   - assertions: [] (empty — must be authored separately)
 *   - protected_surface: undefined (opt-in)
 *   - lineage: undefined (set on first execution)
 */
export function migratePlan(plan: ExecutionPlan): ExecutionPlanV3 {
  if (isPlanV3(plan)) {
    return { ...plan } as ExecutionPlanV3;
  }

  return {
    ...plan,
    version: '3.0',
    assertions: [],
  };
}

/**
 * Check if a plan needs migration.
 */
export function needsMigration(plan: ExecutionPlan): boolean {
  return !isPlanV3(plan);
}

/**
 * Validate that a plan is ready for v3.0 execution.
 * Returns a list of warnings about the migrated plan.
 */
export function migrationWarnings(plan: ExecutionPlanV3): string[] {
  const warnings: string[] = [];

  if (!plan.assertions || plan.assertions.length === 0) {
    warnings.push('No assertions defined. Consider adding assertions for correctness verification.');
  }

  if (!plan.protected_surface) {
    warnings.push('No protected_surface defined. All artifacts will use default drift tolerance.');
  }

  if (!plan.plan_signature) {
    warnings.push('No plan_signature (I/O contract) defined. Consider adding for better traceability.');
  }

  const stepsWithoutDeps = plan.steps.filter(
    (s) => (!s.depends_on || s.depends_on.length === 0) && plan.steps.indexOf(s) > 0,
  );
  if (plan.execution_mode === 'parallel' && stepsWithoutDeps.length > 0) {
    warnings.push(
      `${stepsWithoutDeps.length} step(s) have no depends_on in parallel mode. They will all run in the first layer.`,
    );
  }

  return warnings;
}
