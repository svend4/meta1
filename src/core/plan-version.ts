/**
 * Plan versioning — track plan evolution with semantic diffs and
 * version history. Each version records what changed and why.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getBaseDir } from './paths.js';
import type { ExecutionPlan, Step } from '../types/execution-plan.js';

/** A versioned plan entry */
export interface PlanVersion {
  /** Semantic version (1, 2, 3, ...) */
  version: number;
  /** Plan hash for this version */
  planHash: string;
  /** When this version was created */
  createdAt: string;
  /** Human-readable description of the change */
  changeDescription: string;
  /** Semantic diff from previous version */
  changes: PlanChange[];
  /** The full plan at this version */
  plan: ExecutionPlan;
}

/** A semantic change between two plan versions */
export interface PlanChange {
  type: 'step_added' | 'step_removed' | 'step_modified' | 'metadata_changed' | 'mode_changed';
  /** Step ID affected (if applicable) */
  stepId?: string;
  /** What specifically changed */
  detail: string;
  /** Field that changed (for step_modified) */
  field?: string;
  /** Previous value (summary) */
  from?: string;
  /** New value (summary) */
  to?: string;
}

/** Version history for a plan */
export interface PlanHistory {
  planId: string;
  versions: PlanVersion[];
  currentVersion: number;
}

function getVersionDir(planId: string): string {
  return join(getBaseDir(), 'plan-versions', planId);
}

/**
 * Create a new version of a plan. Auto-detects changes from the previous version.
 */
export function createPlanVersion(
  plan: ExecutionPlan,
  changeDescription: string,
): PlanVersion {
  const dir = getVersionDir(plan.plan_id);
  mkdirSync(dir, { recursive: true });

  const history = loadPlanHistory(plan.plan_id);
  const prevVersion = history.versions.length > 0
    ? history.versions[history.versions.length - 1]
    : null;

  const newVersion = (prevVersion?.version ?? 0) + 1;
  const planHash = hashPlan(plan);

  const changes = prevVersion
    ? computeSemanticDiff(prevVersion.plan, plan)
    : [{ type: 'step_added' as const, detail: `Initial version with ${plan.steps.length} steps` }];

  const version: PlanVersion = {
    version: newVersion,
    planHash,
    createdAt: new Date().toISOString(),
    changeDescription,
    changes,
    plan,
  };

  writeFileSync(
    join(dir, `v${newVersion}.json`),
    JSON.stringify(version, null, 2),
    'utf8',
  );

  return version;
}

/**
 * Load version history for a plan.
 */
export function loadPlanHistory(planId: string): PlanHistory {
  const dir = getVersionDir(planId);
  if (!existsSync(dir)) {
    return { planId, versions: [], currentVersion: 0 };
  }

  const files = readdirSync(dir)
    .filter((f) => f.startsWith('v') && f.endsWith('.json'))
    .sort((a, b) => {
      const na = parseInt(a.slice(1), 10);
      const nb = parseInt(b.slice(1), 10);
      return na - nb;
    });

  const versions: PlanVersion[] = files.map((f) =>
    JSON.parse(readFileSync(join(dir, f), 'utf8')) as PlanVersion,
  );

  return {
    planId,
    versions,
    currentVersion: versions.length > 0 ? versions[versions.length - 1].version : 0,
  };
}

/**
 * Load a specific version of a plan.
 */
export function loadPlanVersion(planId: string, version: number): PlanVersion | null {
  const filePath = join(getVersionDir(planId), `v${version}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8')) as PlanVersion;
}

/**
 * Compute semantic diff between two plans.
 */
export function computeSemanticDiff(
  oldPlan: ExecutionPlan,
  newPlan: ExecutionPlan,
): PlanChange[] {
  const changes: PlanChange[] = [];

  const oldStepMap = new Map(oldPlan.steps.map((s) => [s.step_id, s]));
  const newStepMap = new Map(newPlan.steps.map((s) => [s.step_id, s]));

  // Detect added steps
  for (const [id, step] of newStepMap) {
    if (!oldStepMap.has(id)) {
      changes.push({
        type: 'step_added',
        stepId: id,
        detail: `Added step "${id}" (${step.type}): ${step.description}`,
      });
    }
  }

  // Detect removed steps
  for (const [id, step] of oldStepMap) {
    if (!newStepMap.has(id)) {
      changes.push({
        type: 'step_removed',
        stepId: id,
        detail: `Removed step "${id}" (${step.type}): ${step.description}`,
      });
    }
  }

  // Detect modified steps
  for (const [id, newStep] of newStepMap) {
    const oldStep = oldStepMap.get(id);
    if (!oldStep) continue;

    const stepChanges = diffSteps(oldStep, newStep);
    changes.push(...stepChanges);
  }

  // Detect metadata changes
  if (oldPlan.description !== newPlan.description) {
    changes.push({
      type: 'metadata_changed',
      detail: 'Plan description changed',
      field: 'description',
      from: oldPlan.description ?? '(none)',
      to: newPlan.description ?? '(none)',
    });
  }

  if (oldPlan.execution_mode !== newPlan.execution_mode) {
    changes.push({
      type: 'mode_changed',
      detail: `Execution mode changed`,
      from: oldPlan.execution_mode ?? 'sequential',
      to: newPlan.execution_mode ?? 'sequential',
    });
  }

  return changes;
}

/**
 * Format version history for display.
 */
export function formatPlanHistory(history: PlanHistory): string {
  const lines: string[] = [];
  lines.push(`Plan: ${history.planId}`);
  lines.push(`Versions: ${history.versions.length}`);
  lines.push('');

  for (const v of history.versions) {
    lines.push(`  v${v.version}  ${v.createdAt.slice(0, 19)}  ${v.changeDescription}`);
    for (const c of v.changes) {
      const prefix = c.type === 'step_added' ? '+' : c.type === 'step_removed' ? '-' : '~';
      lines.push(`    ${prefix} ${c.detail}`);
    }
  }

  return lines.join('\n');
}

// ── Internal ──

function hashPlan(plan: ExecutionPlan): string {
  return createHash('sha256')
    .update(JSON.stringify(plan))
    .digest('hex')
    .slice(0, 16);
}

function diffSteps(oldStep: Step, newStep: Step): PlanChange[] {
  const changes: PlanChange[] = [];
  const id = newStep.step_id;

  if (oldStep.description !== newStep.description) {
    changes.push({
      type: 'step_modified', stepId: id,
      detail: `Step "${id}" description changed`,
      field: 'description', from: oldStep.description, to: newStep.description,
    });
  }

  if (oldStep.determinism !== newStep.determinism) {
    changes.push({
      type: 'step_modified', stepId: id,
      detail: `Step "${id}" determinism changed`,
      field: 'determinism', from: oldStep.determinism, to: newStep.determinism,
    });
  }

  const oldDeps = (oldStep.depends_on ?? []).join(',');
  const newDeps = (newStep.depends_on ?? []).join(',');
  if (oldDeps !== newDeps) {
    changes.push({
      type: 'step_modified', stepId: id,
      detail: `Step "${id}" dependencies changed`,
      field: 'depends_on', from: oldDeps || '(none)', to: newDeps || '(none)',
    });
  }

  if (oldStep.type === 'create_file' && newStep.type === 'create_file') {
    if (oldStep.content !== newStep.content) {
      changes.push({
        type: 'step_modified', stepId: id,
        detail: `Step "${id}" file content changed`,
        field: 'content',
      });
    }
    if (oldStep.path !== newStep.path) {
      changes.push({
        type: 'step_modified', stepId: id,
        detail: `Step "${id}" file path changed`,
        field: 'path', from: oldStep.path, to: newStep.path,
      });
    }
  }

  if (oldStep.type === 'run_command' && newStep.type === 'run_command') {
    if (oldStep.command !== newStep.command || JSON.stringify(oldStep.args) !== JSON.stringify(newStep.args)) {
      changes.push({
        type: 'step_modified', stepId: id,
        detail: `Step "${id}" command changed`,
        field: 'command',
        from: `${oldStep.command} ${oldStep.args.join(' ')}`,
        to: `${newStep.command} ${newStep.args.join(' ')}`,
      });
    }
  }

  return changes;
}
