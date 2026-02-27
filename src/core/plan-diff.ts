import type { ExecutionPlan, Step } from '../types/execution-plan.js';

export type ChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

export interface StepDiff {
  stepId: string;
  change: ChangeType;
  fields?: FieldDiff[];
}

export interface FieldDiff {
  field: string;
  old?: string;
  new?: string;
}

export interface PlanDiffResult {
  planIdChanged: boolean;
  descriptionChanged: boolean;
  executionModeChanged: boolean;
  stepsAdded: string[];
  stepsRemoved: string[];
  stepsModified: string[];
  stepsUnchanged: string[];
  stepDiffs: StepDiff[];
  summary: string;
}

/**
 * Compute a structural diff between two execution plans.
 * Matches steps by step_id and compares their fields.
 */
export function diffPlans(a: ExecutionPlan, b: ExecutionPlan): PlanDiffResult {
  const aStepMap = new Map(a.steps.map((s) => [s.step_id, s]));
  const bStepMap = new Map(b.steps.map((s) => [s.step_id, s]));

  const allIds = new Set([...aStepMap.keys(), ...bStepMap.keys()]);
  const stepDiffs: StepDiff[] = [];
  const stepsAdded: string[] = [];
  const stepsRemoved: string[] = [];
  const stepsModified: string[] = [];
  const stepsUnchanged: string[] = [];

  for (const id of allIds) {
    const stepA = aStepMap.get(id);
    const stepB = bStepMap.get(id);

    if (!stepA && stepB) {
      stepsAdded.push(id);
      stepDiffs.push({ stepId: id, change: 'added' });
    } else if (stepA && !stepB) {
      stepsRemoved.push(id);
      stepDiffs.push({ stepId: id, change: 'removed' });
    } else if (stepA && stepB) {
      const fields = diffStep(stepA, stepB);
      if (fields.length > 0) {
        stepsModified.push(id);
        stepDiffs.push({ stepId: id, change: 'modified', fields });
      } else {
        stepsUnchanged.push(id);
        stepDiffs.push({ stepId: id, change: 'unchanged' });
      }
    }
  }

  const planIdChanged = a.plan_id !== b.plan_id;
  const descriptionChanged = (a.description ?? '') !== (b.description ?? '');
  const executionModeChanged = (a.execution_mode ?? 'sequential') !== (b.execution_mode ?? 'sequential');

  const hasChanges = stepsAdded.length > 0 || stepsRemoved.length > 0 || stepsModified.length > 0
    || planIdChanged || descriptionChanged || executionModeChanged;

  let summary: string;
  if (!hasChanges) {
    summary = 'identical';
  } else {
    const parts: string[] = [];
    if (stepsAdded.length > 0) parts.push(`${stepsAdded.length} added`);
    if (stepsRemoved.length > 0) parts.push(`${stepsRemoved.length} removed`);
    if (stepsModified.length > 0) parts.push(`${stepsModified.length} modified`);
    if (stepsUnchanged.length > 0) parts.push(`${stepsUnchanged.length} unchanged`);
    summary = parts.join(', ');
  }

  return {
    planIdChanged,
    descriptionChanged,
    executionModeChanged,
    stepsAdded,
    stepsRemoved,
    stepsModified,
    stepsUnchanged,
    stepDiffs,
    summary,
  };
}

function diffStep(a: Step, b: Step): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  if (a.type !== b.type) {
    diffs.push({ field: 'type', old: a.type, new: b.type });
  }

  if (a.description !== b.description) {
    diffs.push({ field: 'description', old: a.description, new: b.description });
  }

  if (a.determinism !== b.determinism) {
    diffs.push({ field: 'determinism', old: a.determinism, new: b.determinism });
  }

  const aDeps = (a.depends_on ?? []).join(',');
  const bDeps = (b.depends_on ?? []).join(',');
  if (aDeps !== bDeps) {
    diffs.push({ field: 'depends_on', old: aDeps || '(none)', new: bDeps || '(none)' });
  }

  const aTimeout = String(a.timeout_ms ?? '');
  const bTimeout = String(b.timeout_ms ?? '');
  if (aTimeout !== bTimeout) {
    diffs.push({ field: 'timeout_ms', old: aTimeout || '(none)', new: bTimeout || '(none)' });
  }

  if (a.type === 'create_file' && b.type === 'create_file') {
    if (a.path !== b.path) {
      diffs.push({ field: 'path', old: a.path, new: b.path });
    }
    if (a.content !== b.content) {
      diffs.push({
        field: 'content',
        old: truncate(a.content, 200),
        new: truncate(b.content, 200),
      });
    }
  }

  if (a.type === 'run_command' && b.type === 'run_command') {
    if (a.command !== b.command) {
      diffs.push({ field: 'command', old: a.command, new: b.command });
    }
    const aArgs = JSON.stringify(a.args);
    const bArgs = JSON.stringify(b.args);
    if (aArgs !== bArgs) {
      diffs.push({ field: 'args', old: aArgs, new: bArgs });
    }
  }

  return diffs;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

/**
 * Format a plan diff result as a human-readable string.
 */
export function formatPlanDiff(diff: PlanDiffResult): string {
  const lines: string[] = [];

  lines.push(`Plan diff: ${diff.summary}`);
  lines.push('');

  if (diff.planIdChanged) lines.push('  plan_id: changed');
  if (diff.descriptionChanged) lines.push('  description: changed');
  if (diff.executionModeChanged) lines.push('  execution_mode: changed');

  for (const sd of diff.stepDiffs) {
    if (sd.change === 'unchanged') continue;

    if (sd.change === 'added') {
      lines.push(`  + ${sd.stepId} (added)`);
    } else if (sd.change === 'removed') {
      lines.push(`  - ${sd.stepId} (removed)`);
    } else if (sd.change === 'modified' && sd.fields) {
      lines.push(`  ~ ${sd.stepId} (modified)`);
      for (const f of sd.fields) {
        lines.push(`      ${f.field}: ${f.old} → ${f.new}`);
      }
    }
  }

  return lines.join('\n');
}
