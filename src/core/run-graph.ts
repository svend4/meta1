/**
 * Run dependency graph — track cross-run dependencies where one run's
 * outputs feed into another run's inputs, forming a DAG across runs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBaseDir } from './paths.js';

/** A dependency edge between two runs */
export interface RunDependency {
  /** The run that depends on another */
  fromRunId: string;
  /** The run being depended on */
  toRunId: string;
  /** What output is consumed */
  artifact: string;
  /** When the dependency was declared */
  declaredAt: string;
}

/** Status of a run in the dependency graph */
export type RunGraphStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'blocked';

/** A node in the run graph */
export interface RunGraphNode {
  runId: string;
  label?: string;
  status: RunGraphStatus;
  /** Run IDs this run depends on */
  dependsOn: string[];
  /** Run IDs that depend on this run */
  dependedBy: string[];
  /** Artifacts produced by this run */
  produces: string[];
  /** Artifacts consumed by this run */
  consumes: string[];
}

/** The full run dependency graph */
export interface RunGraph {
  nodes: RunGraphNode[];
  edges: RunDependency[];
  lastUpdated: string;
}

function getGraphPath(): string {
  return join(getBaseDir(), 'run-graph.json');
}

/**
 * Load the run dependency graph.
 */
export function loadRunGraph(): RunGraph {
  const path = getGraphPath();
  if (!existsSync(path)) {
    return { nodes: [], edges: [], lastUpdated: new Date().toISOString() };
  }
  return JSON.parse(readFileSync(path, 'utf8')) as RunGraph;
}

function saveRunGraph(graph: RunGraph): void {
  mkdirSync(getBaseDir(), { recursive: true });
  graph.lastUpdated = new Date().toISOString();
  writeFileSync(getGraphPath(), JSON.stringify(graph, null, 2), 'utf8');
}

/**
 * Add a run node to the graph.
 */
export function addRunNode(
  runId: string,
  options?: { label?: string; produces?: string[]; consumes?: string[] },
): RunGraphNode {
  const graph = loadRunGraph();

  let node = graph.nodes.find((n) => n.runId === runId);
  if (node) {
    if (options?.label) node.label = options.label;
    if (options?.produces) node.produces = [...new Set([...node.produces, ...options.produces])];
    if (options?.consumes) node.consumes = [...new Set([...node.consumes, ...options.consumes])];
  } else {
    node = {
      runId,
      label: options?.label,
      status: 'pending',
      dependsOn: [],
      dependedBy: [],
      produces: options?.produces ?? [],
      consumes: options?.consumes ?? [],
    };
    graph.nodes.push(node);
  }

  // Auto-wire dependencies based on artifact matching
  autoWireDependencies(graph);
  updateStatuses(graph);
  saveRunGraph(graph);

  return node;
}

/**
 * Add a dependency between two runs.
 */
export function addRunDependency(fromRunId: string, toRunId: string, artifact: string): RunDependency {
  const graph = loadRunGraph();

  const edge: RunDependency = {
    fromRunId,
    toRunId,
    artifact,
    declaredAt: new Date().toISOString(),
  };

  // Ensure nodes exist
  if (!graph.nodes.find((n) => n.runId === fromRunId)) {
    graph.nodes.push({ runId: fromRunId, status: 'pending', dependsOn: [], dependedBy: [], produces: [], consumes: [artifact] });
  }
  if (!graph.nodes.find((n) => n.runId === toRunId)) {
    graph.nodes.push({ runId: toRunId, status: 'pending', dependsOn: [], dependedBy: [], produces: [artifact], consumes: [] });
  }

  // Add edge
  graph.edges.push(edge);

  // Update adjacency
  const from = graph.nodes.find((n) => n.runId === fromRunId)!;
  const to = graph.nodes.find((n) => n.runId === toRunId)!;
  if (!from.dependsOn.includes(toRunId)) from.dependsOn.push(toRunId);
  if (!to.dependedBy.includes(fromRunId)) to.dependedBy.push(fromRunId);

  updateStatuses(graph);
  saveRunGraph(graph);

  return edge;
}

/**
 * Update the status of a run in the graph.
 */
export function updateRunStatus(runId: string, status: RunGraphStatus): boolean {
  const graph = loadRunGraph();
  const node = graph.nodes.find((n) => n.runId === runId);
  if (!node) return false;

  node.status = status;
  updateStatuses(graph);
  saveRunGraph(graph);
  return true;
}

/**
 * Get runs that are ready to execute (all dependencies completed).
 */
export function getReadyRuns(): RunGraphNode[] {
  const graph = loadRunGraph();
  return graph.nodes.filter((n) => n.status === 'ready');
}

/**
 * Get the execution order (topological sort).
 */
export function getExecutionOrder(): string[] {
  const graph = loadRunGraph();
  const order: string[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  const nodeMap = new Map(graph.nodes.map((n) => [n.runId, n]));

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (temp.has(id)) return; // cycle
    temp.add(id);

    const node = nodeMap.get(id);
    if (node) {
      for (const dep of node.dependsOn) {
        visit(dep);
      }
    }

    temp.delete(id);
    visited.add(id);
    order.push(id);
  }

  for (const node of graph.nodes) {
    visit(node.runId);
  }

  return order;
}

/**
 * Detect cycles in the run graph.
 */
export function detectCycles(): string[][] {
  const graph = loadRunGraph();
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  const nodeMap = new Map(graph.nodes.map((n) => [n.runId, n]));

  function dfs(id: string): void {
    if (stack.has(id)) {
      const cycleStart = path.indexOf(id);
      cycles.push(path.slice(cycleStart).concat(id));
      return;
    }
    if (visited.has(id)) return;

    visited.add(id);
    stack.add(id);
    path.push(id);

    const node = nodeMap.get(id);
    if (node) {
      for (const dep of node.dependsOn) {
        dfs(dep);
      }
    }

    path.pop();
    stack.delete(id);
  }

  for (const node of graph.nodes) {
    dfs(node.runId);
  }

  return cycles;
}

/**
 * Format the run graph for display.
 */
export function formatRunGraph(graph?: RunGraph): string {
  const g = graph ?? loadRunGraph();
  const lines: string[] = [];

  lines.push(`Run Dependency Graph (${g.nodes.length} runs, ${g.edges.length} edges)`);
  lines.push('');

  for (const node of g.nodes) {
    const label = node.label ? ` (${node.label})` : '';
    const status = node.status.toUpperCase();
    lines.push(`  ${node.runId.slice(0, 12)}${label}  [${status}]`);

    if (node.dependsOn.length > 0) {
      lines.push(`    depends on: ${node.dependsOn.map((d) => d.slice(0, 12)).join(', ')}`);
    }
    if (node.produces.length > 0) {
      lines.push(`    produces: ${node.produces.join(', ')}`);
    }
    if (node.consumes.length > 0) {
      lines.push(`    consumes: ${node.consumes.join(', ')}`);
    }
  }

  return lines.join('\n');
}

// ── Internal ──

function autoWireDependencies(graph: RunGraph): void {
  for (const consumer of graph.nodes) {
    for (const artifact of consumer.consumes) {
      for (const producer of graph.nodes) {
        if (producer.runId === consumer.runId) continue;
        if (producer.produces.includes(artifact)) {
          if (!consumer.dependsOn.includes(producer.runId)) {
            consumer.dependsOn.push(producer.runId);
            producer.dependedBy.push(consumer.runId);
            graph.edges.push({
              fromRunId: consumer.runId,
              toRunId: producer.runId,
              artifact,
              declaredAt: new Date().toISOString(),
            });
          }
        }
      }
    }
  }
}

function updateStatuses(graph: RunGraph): void {
  for (const node of graph.nodes) {
    if (node.status === 'completed' || node.status === 'failed' || node.status === 'running') continue;

    if (node.dependsOn.length === 0) {
      if (node.status === 'pending') node.status = 'ready';
    } else {
      const allCompleted = node.dependsOn.every((dep) => {
        const depNode = graph.nodes.find((n) => n.runId === dep);
        return depNode?.status === 'completed';
      });
      const anyFailed = node.dependsOn.some((dep) => {
        const depNode = graph.nodes.find((n) => n.runId === dep);
        return depNode?.status === 'failed';
      });

      if (anyFailed) {
        node.status = 'blocked';
      } else if (allCompleted) {
        node.status = 'ready';
      }
    }
  }
}
