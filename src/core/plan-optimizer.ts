/**
 * Plan optimizer — reorders and restructures plans for better
 * parallelism without changing semantics. Produces an equivalent
 * plan that executes faster in parallel mode.
 */

import type { ExecutionPlan, Step, CreateFileStep } from '../types/execution-plan.js';
import { dirname } from 'node:path';

/** Optimization applied to the plan */
export interface Optimization {
  type: string;
  description: string;
  stepsAffected: string[];
}

/** Result of plan optimization */
export interface OptimizationResult {
  /** Optimized plan */
  plan: ExecutionPlan;
  /** Optimizations applied */
  optimizations: Optimization[];
  /** Stats before/after */
  stats: {
    originalLayers: number;
    optimizedLayers: number;
    removedDeps: number;
    parallelGain: number;
  };
}

/**
 * Optimize a plan for better parallelism.
 */
export function optimizePlan(plan: ExecutionPlan): OptimizationResult {
  const optimizations: Optimization[] = [];
  let steps: Step[] = plan.steps.map((s) => ({ ...s, depends_on: [...(s.depends_on ?? [])] }));
  let removedDeps = 0;

  const originalLayers = countLayers(steps);

  // Optimization 1: Remove redundant transitive dependencies
  const transResult = removeTransitiveDeps(steps);
  steps = transResult.steps;
  if (transResult.removed > 0) {
    removedDeps += transResult.removed;
    optimizations.push({
      type: 'remove-transitive-deps',
      description: `Removed ${transResult.removed} redundant transitive dependencies`,
      stepsAffected: transResult.affectedSteps,
    });
  }

  // Optimization 2: Relax file creation ordering
  const relaxResult = relaxFileOrdering(steps);
  steps = relaxResult.steps;
  if (relaxResult.relaxed > 0) {
    removedDeps += relaxResult.relaxed;
    optimizations.push({
      type: 'relax-file-ordering',
      description: `Relaxed ${relaxResult.relaxed} unnecessary file ordering constraints`,
      stepsAffected: relaxResult.affectedSteps,
    });
  }

  // Optimization 3: Suggest parallel mode if sequential with independent steps
  let mode = plan.execution_mode;
  if ((!mode || mode === 'sequential') && hasIndependentSteps(steps)) {
    mode = 'parallel';
    optimizations.push({
      type: 'enable-parallel',
      description: 'Switched to parallel execution mode — independent steps detected',
      stepsAffected: steps.filter((s) => !(s.depends_on?.length)).map((s) => s.step_id),
    });
  }

  const optimizedLayers = countLayers(steps);

  return {
    plan: { ...plan, steps, execution_mode: mode },
    optimizations,
    stats: {
      originalLayers,
      optimizedLayers,
      removedDeps,
      parallelGain: originalLayers > 0
        ? Math.round((1 - optimizedLayers / originalLayers) * 100)
        : 0,
    },
  };
}

/**
 * Remove transitive dependencies that don't affect execution order.
 * If A→B→C and A→C, the A→C edge is redundant.
 */
function removeTransitiveDeps(steps: Step[]): {
  steps: Step[];
  removed: number;
  affectedSteps: string[];
} {
  const adj = new Map<string, Set<string>>();
  for (const s of steps) {
    // Build reverse map: for each step, which steps depend on it
    adj.set(s.step_id, new Set(s.depends_on ?? []));
  }

  let removed = 0;
  const affected = new Set<string>();

  for (const step of steps) {
    const deps = step.depends_on ?? [];
    if (deps.length < 2) continue;

    const toRemove = new Set<string>();

    for (const dep of deps) {
      for (const otherDep of deps) {
        if (dep === otherDep) continue;
        if (isReachableVia(otherDep, dep, adj, new Set())) {
          toRemove.add(dep);
          break;
        }
      }
    }

    if (toRemove.size > 0) {
      step.depends_on = deps.filter((d) => !toRemove.has(d));
      removed += toRemove.size;
      affected.add(step.step_id);
    }
  }

  return { steps, removed, affectedSteps: [...affected] };
}

/**
 * Relax file creation ordering: if two create_file steps write to
 * different directories and don't read each other's output, they
 * can run in parallel.
 */
function relaxFileOrdering(steps: Step[]): {
  steps: Step[];
  relaxed: number;
  affectedSteps: string[];
} {
  let relaxed = 0;
  const affected = new Set<string>();

  for (const step of steps) {
    if (step.type !== 'create_file') continue;
    const deps = step.depends_on ?? [];
    if (deps.length === 0) continue;

    const toRemove = new Set<string>();

    for (const depId of deps) {
      const depStep = steps.find((s) => s.step_id === depId);
      if (!depStep || depStep.type !== 'create_file') continue;

      // If different directories, they can be parallelized
      const thisDir = dirname((step as CreateFileStep).path);
      const depDir = dirname((depStep as CreateFileStep).path);

      if (thisDir !== depDir && thisDir !== '.' && depDir !== '.') {
        toRemove.add(depId);
      }
    }

    if (toRemove.size > 0) {
      step.depends_on = deps.filter((d) => !toRemove.has(d));
      relaxed += toRemove.size;
      affected.add(step.step_id);
    }
  }

  return { steps, relaxed, affectedSteps: [...affected] };
}

function hasIndependentSteps(steps: Step[]): boolean {
  const independent = steps.filter((s) => !(s.depends_on?.length));
  return independent.length >= 2;
}

function isReachableVia(from: string, target: string, adj: Map<string, Set<string>>, visited: Set<string>): boolean {
  if (from === target) return true;
  if (visited.has(from)) return false;
  visited.add(from);

  const deps = adj.get(from);
  if (!deps) return false;

  for (const dep of deps) {
    if (isReachableVia(dep, target, adj, visited)) return true;
  }
  return false;
}

function countLayers(steps: Step[]): number {
  if (steps.length === 0) return 0;

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const s of steps) {
    inDegree.set(s.step_id, 0);
    dependents.set(s.step_id, []);
  }

  for (const s of steps) {
    for (const dep of s.depends_on ?? []) {
      if (dependents.has(dep)) {
        dependents.get(dep)!.push(s.step_id);
      }
      inDegree.set(s.step_id, (inDegree.get(s.step_id) ?? 0) + 1);
    }
  }

  let layers = 0;
  const remaining = new Map(inDegree);

  while (remaining.size > 0) {
    const layer = [...remaining.entries()]
      .filter(([, deg]) => deg === 0)
      .map(([id]) => id);

    if (layer.length === 0) break; // cycle
    layers++;

    for (const id of layer) {
      remaining.delete(id);
      for (const child of dependents.get(id) ?? []) {
        if (remaining.has(child)) {
          remaining.set(child, remaining.get(child)! - 1);
        }
      }
    }
  }

  return layers;
}

/**
 * Format optimization result for display.
 */
export function formatOptimization(result: OptimizationResult): string {
  const lines: string[] = [];

  lines.push('Plan Optimization Report');
  lines.push('');

  if (result.optimizations.length === 0) {
    lines.push('  No optimizations applicable — plan is already optimal.');
  } else {
    for (const opt of result.optimizations) {
      lines.push(`  [${opt.type}] ${opt.description}`);
      if (opt.stepsAffected.length > 0) {
        lines.push(`    Steps: ${opt.stepsAffected.join(', ')}`);
      }
    }
  }

  lines.push('');
  lines.push(`  Layers: ${result.stats.originalLayers} → ${result.stats.optimizedLayers}`);
  lines.push(`  Deps removed: ${result.stats.removedDeps}`);
  if (result.stats.parallelGain > 0) {
    lines.push(`  Parallel gain: ${result.stats.parallelGain}%`);
  }

  return lines.join('\n');
}
