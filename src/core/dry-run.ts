import type { ExecutionPlan, Step, ExecutionPlanV3 } from '../types/execution-plan.js';
import { isPlanV3 } from '../types/execution-plan.js';
import { validateExecutionPlan } from './validator.js';
import { buildDependencyGraph } from './executor.js';

export interface DryRunStepPreview {
  step_id: string;
  type: 'create_file' | 'run_command';
  description: string;
  determinism: 'guaranteed' | 'best_effort';
  depends_on: string[];
  layer: number;
}

export interface DryRunResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  plan_id?: string;
  execution_mode: 'sequential' | 'parallel';
  steps: DryRunStepPreview[];
  total_steps: number;
  layers: number;
  files_created: number;
  commands_run: number;
  assertions_count: number;
  has_protected_surface: boolean;
}

/**
 * Analyze a plan without executing it.
 * Validates structure, checks dependencies, computes execution layers.
 */
export function analyzePlan(plan: unknown): DryRunResult {
  const warnings: string[] = [];

  // Step 1: Validate structure
  const validation = validateExecutionPlan(plan);
  if (!validation.valid) {
    return {
      valid: false,
      errors: validation.errors,
      warnings,
      execution_mode: 'sequential',
      steps: [],
      total_steps: 0,
      layers: 0,
      files_created: 0,
      commands_run: 0,
      assertions_count: 0,
      has_protected_surface: false,
    };
  }

  const execPlan = plan as ExecutionPlan;
  const mode = execPlan.execution_mode ?? 'sequential';

  // Step 2: Validate dependency graph
  try {
    buildDependencyGraph(execPlan.steps);
  } catch (err: unknown) {
    return {
      valid: false,
      errors: [err instanceof Error ? err.message : String(err)],
      warnings,
      plan_id: execPlan.plan_id,
      execution_mode: mode,
      steps: [],
      total_steps: execPlan.steps.length,
      layers: 0,
      files_created: 0,
      commands_run: 0,
      assertions_count: 0,
      has_protected_surface: false,
    };
  }

  // Step 3: Compute topological layers
  const layers = computeLayers(execPlan.steps);
  const stepPreviews: DryRunStepPreview[] = [];

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    for (const step of layers[layerIdx]) {
      stepPreviews.push({
        step_id: step.step_id,
        type: step.type,
        description: step.description,
        determinism: step.determinism,
        depends_on: step.depends_on ?? [],
        layer: layerIdx,
      });
    }
  }

  // Step 4: Count step types
  const filesCreated = execPlan.steps.filter((s) => s.type === 'create_file').length;
  const commandsRun = execPlan.steps.filter((s) => s.type === 'run_command').length;

  // Step 5: Check v3.0 features
  let assertionsCount = 0;
  let hasProtectedSurface = false;

  if (isPlanV3(execPlan)) {
    const v3 = execPlan as ExecutionPlanV3;
    assertionsCount = v3.assertions?.length ?? 0;
    hasProtectedSurface = !!v3.protected_surface;
  }

  // Step 6: Generate warnings
  const bestEffort = execPlan.steps.filter((s) => s.determinism === 'best_effort');
  if (bestEffort.length > 0) {
    warnings.push(`${bestEffort.length} step(s) marked best_effort — replay may diverge`);
  }

  if (mode === 'sequential' && execPlan.steps.some((s) => s.depends_on?.length)) {
    warnings.push('Plan has depends_on fields but execution_mode is sequential — dependencies ignored');
  }

  return {
    valid: true,
    errors: [],
    warnings,
    plan_id: execPlan.plan_id,
    execution_mode: mode,
    steps: stepPreviews,
    total_steps: execPlan.steps.length,
    layers: layers.length,
    files_created: filesCreated,
    commands_run: commandsRun,
    assertions_count: assertionsCount,
    has_protected_surface: hasProtectedSurface,
  };
}

/**
 * Compute topological layers for step scheduling.
 * Steps at the same layer have no dependencies on each other.
 * Exported for reuse by graph.ts.
 */
export function computeLayers(steps: Step[]): Step[][] {
  if (steps.length === 0) return [];

  const ids = new Set(steps.map((s) => s.step_id));
  const stepMap = new Map(steps.map((s) => [s.step_id, s]));
  const inDeg = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const step of steps) {
    inDeg.set(step.step_id, 0);
    dependents.set(step.step_id, []);
  }

  for (const step of steps) {
    for (const dep of step.depends_on ?? []) {
      if (!ids.has(dep)) continue;
      dependents.get(dep)!.push(step.step_id);
      inDeg.set(step.step_id, (inDeg.get(step.step_id) ?? 0) + 1);
    }
  }

  const layers: Step[][] = [];
  let ready = steps.filter((s) => inDeg.get(s.step_id) === 0);

  while (ready.length > 0) {
    layers.push(ready);
    const nextReady: Step[] = [];
    for (const step of ready) {
      for (const child of dependents.get(step.step_id) ?? []) {
        const newDeg = inDeg.get(child)! - 1;
        inDeg.set(child, newDeg);
        if (newDeg === 0) nextReady.push(stepMap.get(child)!);
      }
    }
    ready = nextReady;
  }

  return layers;
}
