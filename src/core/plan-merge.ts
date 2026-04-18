/**
 * Plan merge — three-way merge of execution plans with conflict detection,
 * resolution strategies, and merge reporting.
 */

import type { ExecutionPlan, Step } from '../types/execution-plan.js';

/** A conflict between two plan versions */
export interface MergeConflict {
  stepId: string;
  field: string;
  baseValue: string | undefined;
  oursValue: string | undefined;
  theirsValue: string | undefined;
  resolution?: 'ours' | 'theirs' | 'base';
}

/** Strategy for resolving conflicts */
export type ConflictStrategy = 'ours' | 'theirs' | 'fail' | 'manual';

/** Options for plan merge */
export interface MergeOptions {
  /** How to resolve conflicts */
  strategy: ConflictStrategy;
  /** ID for the merged plan */
  planId?: string;
  /** Manual conflict resolutions (stepId:field → 'ours' | 'theirs' | 'base') */
  resolutions?: Record<string, 'ours' | 'theirs' | 'base'>;
}

/** Result of a plan merge */
export interface MergeResult {
  success: boolean;
  plan?: ExecutionPlan;
  conflicts: MergeConflict[];
  /** Steps added in ours that weren't in base */
  addedOurs: string[];
  /** Steps added in theirs that weren't in base */
  addedTheirs: string[];
  /** Steps removed in ours */
  removedOurs: string[];
  /** Steps removed in theirs */
  removedTheirs: string[];
  /** Steps modified */
  modified: string[];
}

/**
 * Three-way merge of execution plans.
 * @param base The common ancestor plan
 * @param ours Our modified plan
 * @param theirs Their modified plan
 */
export function mergePlans(
  base: ExecutionPlan,
  ours: ExecutionPlan,
  theirs: ExecutionPlan,
  options?: MergeOptions,
): MergeResult {
  const opts: MergeOptions = {
    strategy: 'fail',
    ...options,
  };

  const baseSteps = new Map(base.steps.map((s) => [s.step_id, s]));
  const ourSteps = new Map(ours.steps.map((s) => [s.step_id, s]));
  const theirSteps = new Map(theirs.steps.map((s) => [s.step_id, s]));

  const allIds = new Set([...baseSteps.keys(), ...ourSteps.keys(), ...theirSteps.keys()]);

  const conflicts: MergeConflict[] = [];
  const mergedSteps: Step[] = [];
  const addedOurs: string[] = [];
  const addedTheirs: string[] = [];
  const removedOurs: string[] = [];
  const removedTheirs: string[] = [];
  const modified: string[] = [];

  for (const id of allIds) {
    const inBase = baseSteps.has(id);
    const inOurs = ourSteps.has(id);
    const inTheirs = theirSteps.has(id);

    // New in ours only
    if (!inBase && inOurs && !inTheirs) {
      mergedSteps.push(ourSteps.get(id)!);
      addedOurs.push(id);
      continue;
    }

    // New in theirs only
    if (!inBase && !inOurs && inTheirs) {
      mergedSteps.push(theirSteps.get(id)!);
      addedTheirs.push(id);
      continue;
    }

    // New in both — conflict
    if (!inBase && inOurs && inTheirs) {
      const stepConflicts = diffSteps(undefined, ourSteps.get(id)!, theirSteps.get(id)!);
      if (stepConflicts.length > 0) {
        conflicts.push(...stepConflicts);
        const resolved = resolveStep(undefined, ourSteps.get(id)!, theirSteps.get(id)!, stepConflicts, opts);
        if (resolved) mergedSteps.push(resolved);
      } else {
        mergedSteps.push(ourSteps.get(id)!);
      }
      addedOurs.push(id);
      addedTheirs.push(id);
      continue;
    }

    // Removed in ours, unchanged in theirs
    if (inBase && !inOurs && inTheirs) {
      const theirChanged = stepsChanged(baseSteps.get(id)!, theirSteps.get(id)!);
      if (theirChanged) {
        // Conflict: we deleted, they modified
        conflicts.push({
          stepId: id,
          field: '_existence',
          baseValue: 'present',
          oursValue: 'deleted',
          theirsValue: 'modified',
        });
        if (opts.strategy === 'ours') {
          removedOurs.push(id);
        } else if (opts.strategy === 'theirs') {
          mergedSteps.push(theirSteps.get(id)!);
        }
      } else {
        removedOurs.push(id);
      }
      continue;
    }

    // Removed in theirs, unchanged in ours
    if (inBase && inOurs && !inTheirs) {
      const ourChanged = stepsChanged(baseSteps.get(id)!, ourSteps.get(id)!);
      if (ourChanged) {
        conflicts.push({
          stepId: id,
          field: '_existence',
          baseValue: 'present',
          oursValue: 'modified',
          theirsValue: 'deleted',
        });
        if (opts.strategy === 'theirs') {
          removedTheirs.push(id);
        } else if (opts.strategy === 'ours') {
          mergedSteps.push(ourSteps.get(id)!);
        }
      } else {
        removedTheirs.push(id);
      }
      continue;
    }

    // Removed in both
    if (inBase && !inOurs && !inTheirs) {
      removedOurs.push(id);
      removedTheirs.push(id);
      continue;
    }

    // Present in all three — check for modifications
    if (inBase && inOurs && inTheirs) {
      const baseStep = baseSteps.get(id)!;
      const ourStep = ourSteps.get(id)!;
      const theirStep = theirSteps.get(id)!;

      const ourChanged = stepsChanged(baseStep, ourStep);
      const theirChanged = stepsChanged(baseStep, theirStep);

      if (!ourChanged && !theirChanged) {
        // No changes
        mergedSteps.push(baseStep);
      } else if (ourChanged && !theirChanged) {
        // Only ours changed
        mergedSteps.push(ourStep);
        modified.push(id);
      } else if (!ourChanged && theirChanged) {
        // Only theirs changed
        mergedSteps.push(theirStep);
        modified.push(id);
      } else {
        // Both changed — potential conflict
        const stepConflicts = diffSteps(baseStep, ourStep, theirStep);
        if (stepConflicts.length > 0) {
          conflicts.push(...stepConflicts);
          const resolved = resolveStep(baseStep, ourStep, theirStep, stepConflicts, opts);
          if (resolved) {
            mergedSteps.push(resolved);
            modified.push(id);
          }
        } else {
          // Same changes on both sides
          mergedSteps.push(ourStep);
          modified.push(id);
        }
      }
    }
  }

  const success = opts.strategy === 'fail' ? conflicts.length === 0 : true;

  const plan: ExecutionPlan | undefined = success || opts.strategy !== 'fail'
    ? {
        plan_id: opts.planId ?? `merged-${Date.now()}`,
        steps: mergedSteps,
        execution_mode: ours.execution_mode ?? theirs.execution_mode ?? base.execution_mode,
      }
    : undefined;

  return { success, plan, conflicts, addedOurs, addedTheirs, removedOurs, removedTheirs, modified };
}

/**
 * Format merge result for display.
 */
export function formatMergeResult(result: MergeResult): string {
  const lines: string[] = [];
  const status = result.success ? 'MERGED' : 'CONFLICTS';

  lines.push(`Merge: ${status}`);
  if (result.addedOurs.length) lines.push(`  Added (ours): ${result.addedOurs.join(', ')}`);
  if (result.addedTheirs.length) lines.push(`  Added (theirs): ${result.addedTheirs.join(', ')}`);
  if (result.removedOurs.length) lines.push(`  Removed (ours): ${result.removedOurs.join(', ')}`);
  if (result.removedTheirs.length) lines.push(`  Removed (theirs): ${result.removedTheirs.join(', ')}`);
  if (result.modified.length) lines.push(`  Modified: ${result.modified.join(', ')}`);

  if (result.conflicts.length > 0) {
    lines.push(`  Conflicts: ${result.conflicts.length}`);
    for (const c of result.conflicts) {
      lines.push(`    ${c.stepId}.${c.field}: ours=${c.oursValue ?? '∅'} theirs=${c.theirsValue ?? '∅'}`);
    }
  }

  return lines.join('\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getField(step: Step, field: string): any {
  return (step as any)[field];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setField(step: Step, field: string, value: any): void {
  (step as any)[field] = value;
}

// ── Internal ──

function stepsChanged(a: Step, b: Step): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function diffSteps(base: Step | undefined, ours: Step, theirs: Step): MergeConflict[] {
  const conflicts: MergeConflict[] = [];
  const id = ours.step_id;

  // Compare common fields
  const fields = ['description', 'type', 'determinism'] as const;
  for (const field of fields) {
    const bVal = base ? String(getField(base, field) ?? '') : undefined;
    const oVal = String(getField(ours, field) ?? '');
    const tVal = String(getField(theirs, field) ?? '');

    if (oVal !== tVal && (bVal === undefined || (oVal !== bVal && tVal !== bVal))) {
      conflicts.push({ stepId: id, field, baseValue: bVal, oursValue: oVal, theirsValue: tVal });
    }
  }

  // Type-specific fields
  if (ours.type === 'create_file' && theirs.type === 'create_file') {
    const bStep = base?.type === 'create_file' ? base : undefined;

    if (ours.content !== theirs.content && (!bStep || (ours.content !== bStep.content && theirs.content !== bStep.content))) {
      conflicts.push({ stepId: id, field: 'content', baseValue: bStep?.content, oursValue: ours.content, theirsValue: theirs.content });
    }
    if (ours.path !== theirs.path && (!bStep || (ours.path !== bStep.path && theirs.path !== bStep.path))) {
      conflicts.push({ stepId: id, field: 'path', baseValue: bStep?.path, oursValue: ours.path, theirsValue: theirs.path });
    }
  }

  if (ours.type === 'run_command' && theirs.type === 'run_command') {
    const bStep = base?.type === 'run_command' ? base : undefined;

    if (ours.command !== theirs.command && (!bStep || (ours.command !== bStep.command && theirs.command !== bStep.command))) {
      conflicts.push({ stepId: id, field: 'command', baseValue: bStep?.command, oursValue: ours.command, theirsValue: theirs.command });
    }

    const oArgs = JSON.stringify(ours.args);
    const tArgs = JSON.stringify(theirs.args);
    const bArgs = bStep ? JSON.stringify(bStep.args) : undefined;
    if (oArgs !== tArgs && (!bArgs || (oArgs !== bArgs && tArgs !== bArgs))) {
      conflicts.push({ stepId: id, field: 'args', baseValue: bArgs, oursValue: oArgs, theirsValue: tArgs });
    }
  }

  return conflicts;
}

function resolveStep(
  base: Step | undefined,
  ours: Step,
  theirs: Step,
  conflicts: MergeConflict[],
  opts: MergeOptions,
): Step | null {
  if (opts.strategy === 'fail') return null;
  if (opts.strategy === 'ours') return ours;
  if (opts.strategy === 'theirs') return theirs;

  // Manual resolution
  if (opts.strategy === 'manual' && opts.resolutions) {
    const result = JSON.parse(JSON.stringify(ours)) as Step;

    for (const c of conflicts) {
      const key = `${c.stepId}:${c.field}`;
      const resolution = opts.resolutions[key] ?? 'ours';

      if (resolution === 'theirs') {
        setField(result, c.field, getField(theirs, c.field));
      } else if (resolution === 'base' && base) {
        setField(result, c.field, getField(base, c.field));
      }
      c.resolution = resolution;
    }

    return result;
  }

  return ours;
}
