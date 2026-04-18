import type { ExecutionPlan, Step, CreateFileStep, RunCommandStep } from '../types/execution-plan.js';

/** Severity level for deep validation findings */
export type DeepValidationSeverity = 'error' | 'warning' | 'info';

/** A single finding from deep validation */
export interface DeepValidationFinding {
  rule: string;
  severity: DeepValidationSeverity;
  message: string;
  stepIds?: string[];
}

/** Full deep validation report */
export interface DeepValidationReport {
  findings: DeepValidationFinding[];
  errors: number;
  warnings: number;
  passed: boolean;
  stats: {
    totalSteps: number;
    roots: number;
    leaves: number;
    maxDepth: number;
    parallelizable: number;
  };
}

/**
 * Deep semantic validation of a plan — goes beyond lint to check graph
 * integrity, resource conflicts, ordering problems, and reachability.
 */
export function deepValidatePlan(plan: ExecutionPlan): DeepValidationReport {
  const findings: DeepValidationFinding[] = [];

  // Graph structure checks
  const cycles = detectCycles(plan.steps);
  if (cycles.length > 0) {
    for (const cycle of cycles) {
      findings.push({
        rule: 'dependency-cycle',
        severity: 'error',
        message: `Dependency cycle detected: ${cycle.join(' → ')} → ${cycle[0]}`,
        stepIds: cycle,
      });
    }
  }

  findUnreachableSteps(plan, findings);
  findOrphanedDependencies(plan, findings);
  findRedundantDependencies(plan, findings);

  // Resource conflict checks
  findWriteWriteConflicts(plan, findings);
  findWriteReadOrderViolations(plan, findings);
  findCommandOutputConflicts(plan, findings);

  // Semantic checks
  findUnnecessarySequential(plan, findings);
  if (cycles.length === 0) {
    findLongCriticalPath(plan, findings);
  }

  // Compute stats
  const adj = buildAdjacency(plan.steps);
  const roots = plan.steps.filter((s) => !(s.depends_on?.length));
  const leaves = plan.steps.filter((s) => {
    return !plan.steps.some((o) => (o.depends_on ?? []).includes(s.step_id));
  });
  const maxDepth = cycles.length === 0 ? computeMaxDepth(plan.steps, adj) : -1;
  const parallelizable = computeParallelizable(plan.steps);

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;

  return {
    findings,
    errors,
    warnings,
    passed: errors === 0,
    stats: {
      totalSteps: plan.steps.length,
      roots: roots.length,
      leaves: leaves.length,
      maxDepth,
      parallelizable,
    },
  };
}

// ── Cycle Detection (DFS-based) ──

function detectCycles(steps: Step[]): string[][] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const cycles: string[][] = [];

  for (const s of steps) color.set(s.step_id, WHITE);

  function dfs(u: string): void {
    color.set(u, GRAY);

    const step = steps.find((s) => s.step_id === u);
    for (const v of step?.depends_on ?? []) {
      if (!color.has(v)) continue;

      if (color.get(v) === GRAY) {
        // Found a cycle — reconstruct it
        const cycle: string[] = [v];
        let cur = u;
        while (cur !== v) {
          cycle.push(cur);
          cur = parent.get(cur)!;
          if (!cur) break;
        }
        cycle.reverse();
        cycles.push(cycle);
      } else if (color.get(v) === WHITE) {
        parent.set(v, u);
        dfs(v);
      }
    }

    color.set(u, BLACK);
  }

  for (const s of steps) {
    if (color.get(s.step_id) === WHITE) {
      parent.set(s.step_id, null);
      dfs(s.step_id);
    }
  }

  return cycles;
}

// ── Unreachable Steps ──

function findUnreachableSteps(plan: ExecutionPlan, findings: DeepValidationFinding[]): void {
  if (plan.execution_mode !== 'parallel') return;

  const reachable = new Set<string>();
  const roots = plan.steps.filter((s) => !(s.depends_on?.length));

  function walk(stepId: string): void {
    if (reachable.has(stepId)) return;
    reachable.add(stepId);
    for (const s of plan.steps) {
      if ((s.depends_on ?? []).includes(stepId)) {
        walk(s.step_id);
      }
    }
  }

  for (const root of roots) walk(root.step_id);

  const unreachable = plan.steps.filter((s) => !reachable.has(s.step_id));
  if (unreachable.length > 0) {
    findings.push({
      rule: 'unreachable-steps',
      severity: 'warning',
      message: `${unreachable.length} step(s) are unreachable from any root: ${unreachable.map((s) => s.step_id).join(', ')}`,
      stepIds: unreachable.map((s) => s.step_id),
    });
  }
}

// ── Orphaned Dependencies ──

function findOrphanedDependencies(plan: ExecutionPlan, findings: DeepValidationFinding[]): void {
  const ids = new Set(plan.steps.map((s) => s.step_id));

  for (const step of plan.steps) {
    for (const dep of step.depends_on ?? []) {
      if (!ids.has(dep)) {
        findings.push({
          rule: 'orphaned-dependency',
          severity: 'error',
          message: `Step "${step.step_id}" depends on "${dep}" which does not exist`,
          stepIds: [step.step_id],
        });
      }
    }
  }
}

// ── Redundant Dependencies (transitive) ──

function findRedundantDependencies(plan: ExecutionPlan, findings: DeepValidationFinding[]): void {
  const adj = buildAdjacency(plan.steps);

  for (const step of plan.steps) {
    const deps = step.depends_on ?? [];
    if (deps.length < 2) continue;

    for (const dep of deps) {
      // Check if dep is transitively reachable through other deps
      const otherDeps = deps.filter((d) => d !== dep);
      for (const other of otherDeps) {
        if (isReachable(other, dep, adj)) {
          findings.push({
            rule: 'redundant-dependency',
            severity: 'info',
            message: `Step "${step.step_id}" directly depends on "${dep}", but "${dep}" is already transitively required through "${other}"`,
            stepIds: [step.step_id, dep, other],
          });
          break;
        }
      }
    }
  }
}

// ── Write-Write Conflicts ──

function findWriteWriteConflicts(plan: ExecutionPlan, findings: DeepValidationFinding[]): void {
  const writers = new Map<string, string[]>();

  for (const step of plan.steps) {
    if (step.type === 'create_file') {
      const path = (step as CreateFileStep).path;
      if (!writers.has(path)) writers.set(path, []);
      writers.get(path)!.push(step.step_id);
    }
  }

  for (const [path, stepIds] of writers) {
    if (stepIds.length < 2) continue;

    // Check if writers are ordered (one depends on the other)
    const adj = buildAdjacency(plan.steps);
    let hasConflict = false;

    for (let i = 0; i < stepIds.length; i++) {
      for (let j = i + 1; j < stepIds.length; j++) {
        if (!isReachable(stepIds[i], stepIds[j], adj) && !isReachable(stepIds[j], stepIds[i], adj)) {
          hasConflict = true;
          break;
        }
      }
    }

    if (hasConflict) {
      findings.push({
        rule: 'write-write-conflict',
        severity: 'error',
        message: `File "${path}" is written by unordered steps: ${stepIds.join(', ')} — execution order is non-deterministic`,
        stepIds,
      });
    }
  }
}

// ── Write-Read Order Violations ──

function findWriteReadOrderViolations(plan: ExecutionPlan, findings: DeepValidationFinding[]): void {
  const fileWriters = new Map<string, string>();

  for (const step of plan.steps) {
    if (step.type === 'create_file') {
      fileWriters.set((step as CreateFileStep).path, step.step_id);
    }
  }

  const adj = buildAdjacency(plan.steps);

  for (const step of plan.steps) {
    if (step.type !== 'run_command') continue;
    const cmd = step as RunCommandStep;

    // Heuristic: check if command args reference created files
    for (const arg of cmd.args) {
      if (fileWriters.has(arg)) {
        const writer = fileWriters.get(arg)!;
        if (!isReachable(writer, step.step_id, adj)) {
          findings.push({
            rule: 'write-read-unordered',
            severity: 'warning',
            message: `Step "${step.step_id}" may read file "${arg}" created by "${writer}", but has no dependency ordering`,
            stepIds: [writer, step.step_id],
          });
        }
      }
    }
  }
}

// ── Command Output Conflicts ──

function findCommandOutputConflicts(plan: ExecutionPlan, findings: DeepValidationFinding[]): void {
  // Detect commands that likely produce the same output (e.g., two "npm build" without ordering)
  const commands = new Map<string, string[]>();
  const adj = buildAdjacency(plan.steps);

  for (const step of plan.steps) {
    if (step.type !== 'run_command') continue;
    const cmd = step as RunCommandStep;
    const key = `${cmd.command}:${cmd.args.join(',')}`;
    if (!commands.has(key)) commands.set(key, []);
    commands.get(key)!.push(step.step_id);
  }

  for (const [key, stepIds] of commands) {
    if (stepIds.length < 2) continue;

    for (let i = 0; i < stepIds.length; i++) {
      for (let j = i + 1; j < stepIds.length; j++) {
        if (!isReachable(stepIds[i], stepIds[j], adj) && !isReachable(stepIds[j], stepIds[i], adj)) {
          findings.push({
            rule: 'duplicate-command-unordered',
            severity: 'warning',
            message: `Steps "${stepIds[i]}" and "${stepIds[j]}" run the same command (${key.split(':')[0]}) without ordering — possible conflict`,
            stepIds: [stepIds[i], stepIds[j]],
          });
        }
      }
    }
  }
}

// ── Unnecessary Sequential ──

function findUnnecessarySequential(plan: ExecutionPlan, findings: DeepValidationFinding[]): void {
  if (plan.execution_mode !== 'sequential' && plan.execution_mode !== undefined) return;
  if (plan.steps.length < 3) return;

  // Check if plan has no dependencies and could be parallelized
  const hasDeps = plan.steps.some((s) => s.depends_on && s.depends_on.length > 0);
  if (!hasDeps) {
    // Check for independent file-only steps
    const allFiles = plan.steps.every((s) => s.type === 'create_file');
    const paths = plan.steps
      .filter((s): s is CreateFileStep => s.type === 'create_file')
      .map((s) => s.path);
    const uniquePaths = new Set(paths);

    if (allFiles && paths.length === uniquePaths.size) {
      findings.push({
        rule: 'parallelizable-plan',
        severity: 'info',
        message: `Plan has ${plan.steps.length} independent file-creation steps with no dependencies — consider using execution_mode: "parallel"`,
      });
    }
  }
}

// ── Long Critical Path ──

function findLongCriticalPath(plan: ExecutionPlan, findings: DeepValidationFinding[]): void {
  const adj = buildAdjacency(plan.steps);
  const maxDepth = computeMaxDepth(plan.steps, adj);

  if (maxDepth > 10) {
    findings.push({
      rule: 'deep-dependency-chain',
      severity: 'info',
      message: `Plan has a critical path of depth ${maxDepth} — deeply nested dependencies may slow parallel execution`,
    });
  }
}

// ── Graph Helpers ──

type AdjMap = Map<string, string[]>;

function buildAdjacency(steps: Step[]): AdjMap {
  const adj: AdjMap = new Map();
  for (const s of steps) {
    adj.set(s.step_id, s.depends_on ?? []);
  }
  return adj;
}

function isReachable(from: string, to: string, adj: AdjMap): boolean {
  if (from === to) return true;
  const visited = new Set<string>();
  const queue = [from];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);

    // Walk downstream: find all steps that depend on `cur`
    for (const [stepId, deps] of adj) {
      if (deps.includes(cur) && !visited.has(stepId)) {
        if (stepId === to) return true;
        queue.push(stepId);
      }
    }
  }

  return false;
}

function computeMaxDepth(steps: Step[], adj: AdjMap): number {
  const memo = new Map<string, number>();

  function depth(stepId: string): number {
    if (memo.has(stepId)) return memo.get(stepId)!;
    const deps = adj.get(stepId) ?? [];
    const d = deps.length === 0 ? 0 : Math.max(...deps.map((d) => depth(d))) + 1;
    memo.set(stepId, d);
    return d;
  }

  let max = 0;
  for (const s of steps) {
    max = Math.max(max, depth(s.step_id));
  }
  return max;
}

function computeParallelizable(steps: Step[]): number {
  // Count steps with no dependencies (can all run in parallel layer 0)
  return steps.filter((s) => !(s.depends_on?.length)).length;
}

/**
 * Format a deep validation report for human-readable output.
 */
export function formatDeepValidation(report: DeepValidationReport): string {
  const lines: string[] = [];

  lines.push('Deep Validation Report');
  lines.push('');
  lines.push(`  Steps: ${report.stats.totalSteps}  Roots: ${report.stats.roots}  Leaves: ${report.stats.leaves}  Max depth: ${report.stats.maxDepth}  Parallelizable: ${report.stats.parallelizable}`);
  lines.push('');

  if (report.findings.length === 0) {
    lines.push('  No issues found.');
  } else {
    for (const f of report.findings) {
      const prefix = f.severity === 'error' ? 'ERR' : f.severity === 'warning' ? 'WRN' : 'INF';
      lines.push(`  ${prefix}  ${f.rule}: ${f.message}`);
    }
  }

  lines.push('');
  lines.push(`${report.errors} errors, ${report.warnings} warnings — ${report.passed ? 'PASSED' : 'FAILED'}`);

  return lines.join('\n');
}
