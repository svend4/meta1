import type { ExecutionPlan, Step } from '../types/execution-plan.js';

/** Options for DOT graph generation */
export interface DotGraphOptions {
  /** Graph title. Default: plan_id */
  title?: string;
  /** Show step descriptions as labels. Default: true */
  showDescriptions?: boolean;
  /** Orientation: 'TB' (top-to-bottom) or 'LR' (left-to-right). Default: 'TB' */
  rankdir?: 'TB' | 'LR';
}

/**
 * Generate a Graphviz DOT representation of a plan's dependency graph.
 */
export function planToDot(plan: ExecutionPlan, options?: DotGraphOptions): string {
  const title = options?.title ?? plan.plan_id ?? 'Execution Plan';
  const showDesc = options?.showDescriptions ?? true;
  const rankdir = options?.rankdir ?? 'TB';
  const lines: string[] = [];

  lines.push(`digraph "${escDot(title)}" {`);
  lines.push(`  rankdir=${rankdir};`);
  lines.push('  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=10];');
  lines.push('  edge [color="#666666"];');
  lines.push('');

  // Node definitions
  for (const step of plan.steps) {
    const attrs = buildNodeAttrs(step, showDesc);
    lines.push(`  "${escDot(step.step_id)}" [${attrs}];`);
  }

  lines.push('');

  // Edges
  for (const step of plan.steps) {
    for (const dep of step.depends_on ?? []) {
      lines.push(`  "${escDot(dep)}" -> "${escDot(step.step_id)}";`);
    }
  }

  // Rank grouping for parallel layers
  if (plan.execution_mode === 'parallel') {
    const layers = computeLayersSimple(plan.steps);
    lines.push('');
    for (const layer of layers) {
      if (layer.length > 1) {
        const ids = layer.map((s) => `"${escDot(s.step_id)}"`).join('; ');
        lines.push(`  { rank=same; ${ids}; }`);
      }
    }
  }

  lines.push('}');
  return lines.join('\n');
}

function buildNodeAttrs(step: Step, showDesc: boolean): string {
  const parts: string[] = [];

  // Label
  if (showDesc && step.description) {
    const label = `${step.step_id}\\n${truncate(step.description, 40)}`;
    parts.push(`label="${escDot(label)}"`);
  } else {
    parts.push(`label="${escDot(step.step_id)}"`);
  }

  // Colors by type
  if (step.type === 'create_file') {
    parts.push('fillcolor="#d4edda"', 'color="#28a745"');
  } else {
    parts.push('fillcolor="#fff3cd"', 'color="#ffc107"');
  }

  // Determinism indicator
  if (step.determinism === 'best_effort') {
    parts.push('style="rounded,filled,dashed"');
  }

  return parts.join(', ');
}

/**
 * Simple layer computation for DOT rank grouping.
 */
function computeLayersSimple(steps: Step[]): Step[][] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const step of steps) {
    inDegree.set(step.step_id, 0);
    dependents.set(step.step_id, []);
  }

  for (const step of steps) {
    for (const dep of step.depends_on ?? []) {
      dependents.get(dep)?.push(step.step_id);
      inDegree.set(step.step_id, (inDegree.get(step.step_id) ?? 0) + 1);
    }
  }

  const stepMap = new Map(steps.map((s) => [s.step_id, s]));
  const layers: Step[][] = [];
  const remaining = new Map(inDegree);

  while (remaining.size > 0) {
    const layer = [...remaining.entries()]
      .filter(([, deg]) => deg === 0)
      .map(([id]) => stepMap.get(id)!);

    if (layer.length === 0) break; // cycle

    layers.push(layer);

    for (const step of layer) {
      remaining.delete(step.step_id);
      for (const child of dependents.get(step.step_id) ?? []) {
        if (remaining.has(child)) {
          remaining.set(child, remaining.get(child)! - 1);
        }
      }
    }
  }

  return layers;
}

function escDot(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}
