/**
 * Step dependency resolver — automatically infer step ordering from
 * implicit dependencies (file reads/writes, command outputs), build
 * a dependency graph, and compute optimal execution order.
 */

import type { ExecutionPlan, Step } from '../types/execution-plan.js';

/** An inferred dependency between steps */
export interface InferredDependency {
  fromStepId: string;
  toStepId: string;
  reason: string;
  /** The shared resource (file path, env var, etc.) */
  resource: string;
  type: 'file' | 'command_output' | 'environment' | 'ordering';
}

/** Result of dependency resolution */
export interface ResolutionResult {
  /** Steps with updated depends_on */
  steps: Step[];
  /** All inferred dependencies */
  inferred: InferredDependency[];
  /** Steps that had their depends_on modified */
  modified: string[];
  /** Execution order (topological sort) */
  executionOrder: string[];
  /** Maximum parallelism level */
  maxParallelism: number;
}

/** What a step reads and writes */
interface StepIO {
  stepId: string;
  reads: string[];
  writes: string[];
}

/**
 * Resolve implicit dependencies for a plan.
 * Analyzes file paths in create_file steps and command arguments
 * in run_command steps to infer data flow.
 */
export function resolveDependencies(plan: ExecutionPlan): ResolutionResult {
  const ios = plan.steps.map((s) => analyzeStepIO(s));
  const inferred: InferredDependency[] = [];

  // For each step, find which earlier steps produce resources it needs
  for (let i = 0; i < ios.length; i++) {
    const consumer = ios[i];

    for (const readPath of consumer.reads) {
      // Find the latest producer of this path before this step
      for (let j = i - 1; j >= 0; j--) {
        const producer = ios[j];
        if (producer.writes.includes(readPath)) {
          inferred.push({
            fromStepId: consumer.stepId,
            toStepId: producer.stepId,
            reason: `Step reads file "${readPath}" produced by earlier step`,
            resource: readPath,
            type: 'file',
          });
          break; // Only depend on the most recent producer
        }
      }
    }
  }

  // Infer command output dependencies (e.g., step references another step's output path)
  const fileProducers = new Map<string, string>();
  for (const io of ios) {
    for (const w of io.writes) {
      fileProducers.set(w, io.stepId);
    }
  }

  for (const io of ios) {
    for (const r of io.reads) {
      const producer = fileProducers.get(r);
      if (producer && producer !== io.stepId) {
        const exists = inferred.some(
          (d) => d.fromStepId === io.stepId && d.toStepId === producer && d.resource === r,
        );
        if (!exists) {
          inferred.push({
            fromStepId: io.stepId,
            toStepId: producer,
            reason: `Step uses output "${r}" from another step`,
            resource: r,
            type: 'command_output',
          });
        }
      }
    }
  }

  // Apply inferred dependencies to steps
  const steps = plan.steps.map((s) => ({ ...s }));
  const modified: string[] = [];

  for (const step of steps) {
    const deps = inferred
      .filter((d) => d.fromStepId === step.step_id)
      .map((d) => d.toStepId);

    const existing = new Set(step.depends_on ?? []);
    const newDeps = deps.filter((d) => !existing.has(d));

    if (newDeps.length > 0) {
      step.depends_on = [...(step.depends_on ?? []), ...newDeps];
      modified.push(step.step_id);
    }
  }

  // Compute execution order
  const executionOrder = topologicalSort(steps);
  const maxParallelism = computeMaxParallelism(steps);

  return { steps, inferred, modified, executionOrder, maxParallelism };
}

/**
 * Validate that all explicit dependencies are satisfiable.
 */
export function validateDependencies(plan: ExecutionPlan): string[] {
  const issues: string[] = [];
  const stepIds = new Set(plan.steps.map((s) => s.step_id));

  for (const step of plan.steps) {
    if (step.depends_on) {
      for (const dep of step.depends_on) {
        if (!stepIds.has(dep)) {
          issues.push(`Step "${step.step_id}" depends on unknown step "${dep}"`);
        }
      }
    }
  }

  // Check for cycles
  const cycles = detectCycles(plan.steps);
  for (const cycle of cycles) {
    issues.push(`Dependency cycle: ${cycle.join(' → ')}`);
  }

  return issues;
}

/**
 * Format resolution result for display.
 */
export function formatResolution(result: ResolutionResult): string {
  const lines: string[] = [];

  lines.push(`Dependency Resolution: ${result.inferred.length} dependencies inferred`);
  lines.push(`  Modified steps: ${result.modified.length}`);
  lines.push(`  Max parallelism: ${result.maxParallelism}`);
  lines.push(`  Execution order: ${result.executionOrder.join(' → ')}`);

  if (result.inferred.length > 0) {
    lines.push('');
    lines.push('  Inferred Dependencies:');
    for (const d of result.inferred) {
      lines.push(`    ${d.fromStepId} → ${d.toStepId} (${d.type}: ${d.resource})`);
    }
  }

  return lines.join('\n');
}

// ── Internal ──

function analyzeStepIO(step: Step): StepIO {
  const reads: string[] = [];
  const writes: string[] = [];

  if (step.type === 'create_file') {
    writes.push(step.path);
  }

  if (step.type === 'run_command') {
    // Analyze command args for file paths
    for (const arg of step.args) {
      // Heuristic: args that look like file paths
      if (isFilePath(arg)) {
        // If command is a reader (cat, grep, etc.), it reads
        if (isReadCommand(step.command)) {
          reads.push(arg);
        }
        // If command is a writer (cp dest, mv dest, etc.), the last arg is typically a write
        if (isWriteCommand(step.command)) {
          writes.push(arg);
        }
      }
    }

    // Check for input/output redirection patterns in args
    for (let i = 0; i < step.args.length; i++) {
      const arg = step.args[i];
      if ((arg === '-o' || arg === '--output' || arg === '--out') && step.args[i + 1]) {
        writes.push(step.args[i + 1]);
      }
      if ((arg === '-i' || arg === '--input' || arg === '--in') && step.args[i + 1]) {
        reads.push(step.args[i + 1]);
      }
    }
  }

  return { stepId: step.step_id, reads, writes };
}

function isFilePath(arg: string): boolean {
  // Simple heuristic: contains / or . extension, not a flag
  if (arg.startsWith('-')) return false;
  if (arg.includes('/') || arg.includes('.')) return true;
  return false;
}

function isReadCommand(cmd: string): boolean {
  return ['cat', 'grep', 'head', 'tail', 'less', 'more', 'wc', 'sort', 'awk', 'sed'].includes(cmd);
}

function isWriteCommand(cmd: string): boolean {
  return ['cp', 'mv', 'tee', 'touch'].includes(cmd);
}

function topologicalSort(steps: Step[]): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const step of steps) {
    inDegree.set(step.step_id, 0);
    adj.set(step.step_id, []);
  }

  for (const step of steps) {
    if (step.depends_on) {
      for (const dep of step.depends_on) {
        adj.get(dep)?.push(step.step_id);
        inDegree.set(step.step_id, (inDegree.get(step.step_id) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);

    for (const neighbor of adj.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return order;
}

function computeMaxParallelism(steps: Step[]): number {
  // Compute levels using BFS
  const levels = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const step of steps) {
    adj.set(step.step_id, []);
  }

  for (const step of steps) {
    if (step.depends_on) {
      for (const dep of step.depends_on) {
        adj.get(dep)?.push(step.step_id);
      }
    }
  }

  // Compute level for each step
  function getLevel(id: string): number {
    if (levels.has(id)) return levels.get(id)!;
    const step = steps.find((s) => s.step_id === id);
    if (!step?.depends_on?.length) {
      levels.set(id, 0);
      return 0;
    }
    const maxDep = Math.max(...step.depends_on.map((d) => getLevel(d)));
    const level = maxDep + 1;
    levels.set(id, level);
    return level;
  }

  for (const step of steps) getLevel(step.step_id);

  // Count steps per level
  const levelCounts = new Map<number, number>();
  for (const level of levels.values()) {
    levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
  }

  return Math.max(0, ...levelCounts.values());
}

function detectCycles(steps: Step[]): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  const depsMap = new Map(steps.map((s) => [s.step_id, s.depends_on ?? []]));

  function dfs(id: string): void {
    if (stack.has(id)) {
      const start = path.indexOf(id);
      cycles.push(path.slice(start).concat(id));
      return;
    }
    if (visited.has(id)) return;

    visited.add(id);
    stack.add(id);
    path.push(id);

    for (const dep of depsMap.get(id) ?? []) {
      dfs(dep);
    }

    path.pop();
    stack.delete(id);
  }

  for (const step of steps) dfs(step.step_id);

  return cycles;
}
