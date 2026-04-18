import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadRunGraph,
  addRunNode,
  addRunDependency,
  updateRunStatus,
  getReadyRuns,
  getExecutionOrder,
  detectCycles,
  formatRunGraph,
} from '../../src/core/run-graph.js';

let tempDir: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
}));

describe('run-graph', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-rg-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts with empty graph', () => {
    const graph = loadRunGraph();
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it('adds run nodes', () => {
    addRunNode('run-1', { label: 'Build', produces: ['dist.tar'] });
    addRunNode('run-2', { label: 'Deploy', consumes: ['dist.tar'] });

    const graph = loadRunGraph();
    expect(graph.nodes).toHaveLength(2);
  });

  it('auto-wires dependencies by artifact', () => {
    addRunNode('run-1', { produces: ['artifact.tar'] });
    addRunNode('run-2', { consumes: ['artifact.tar'] });

    const graph = loadRunGraph();
    const consumer = graph.nodes.find((n) => n.runId === 'run-2');
    expect(consumer!.dependsOn).toContain('run-1');
  });

  it('adds explicit dependency', () => {
    addRunDependency('run-B', 'run-A', 'output.json');

    const graph = loadRunGraph();
    expect(graph.edges).toHaveLength(1);
    const nodeB = graph.nodes.find((n) => n.runId === 'run-B');
    expect(nodeB!.dependsOn).toContain('run-A');
  });

  it('marks independent runs as ready', () => {
    addRunNode('run-1');
    const ready = getReadyRuns();
    expect(ready).toHaveLength(1);
    expect(ready[0].runId).toBe('run-1');
  });

  it('marks dependent runs as pending until deps complete', () => {
    addRunNode('run-1', { produces: ['out'] });
    addRunNode('run-2', { consumes: ['out'] });

    let ready = getReadyRuns();
    expect(ready.map((r) => r.runId)).toContain('run-1');
    expect(ready.map((r) => r.runId)).not.toContain('run-2');

    updateRunStatus('run-1', 'completed');
    ready = getReadyRuns();
    expect(ready.map((r) => r.runId)).toContain('run-2');
  });

  it('blocks runs when dependency fails', () => {
    addRunNode('run-1', { produces: ['out'] });
    addRunNode('run-2', { consumes: ['out'] });

    updateRunStatus('run-1', 'failed');

    const graph = loadRunGraph();
    const node2 = graph.nodes.find((n) => n.runId === 'run-2');
    expect(node2!.status).toBe('blocked');
  });

  it('returns topological execution order', () => {
    addRunNode('run-a');
    addRunNode('run-b', { consumes: ['x'] });
    addRunNode('run-a', { produces: ['x'] }); // Update run-a

    const order = getExecutionOrder();
    expect(order.indexOf('run-a')).toBeLessThan(order.indexOf('run-b'));
  });

  it('detects no cycles in a DAG', () => {
    addRunNode('a', { produces: ['x'] });
    addRunNode('b', { consumes: ['x'] });

    const cycles = detectCycles();
    expect(cycles).toHaveLength(0);
  });

  it('updates run status', () => {
    addRunNode('run-1');
    expect(updateRunStatus('run-1', 'running')).toBe(true);

    const graph = loadRunGraph();
    expect(graph.nodes[0].status).toBe('running');
  });

  it('returns false for updating unknown run', () => {
    expect(updateRunStatus('ghost', 'running')).toBe(false);
  });

  it('formats graph', () => {
    addRunNode('run-1', { label: 'Build', produces: ['out'] });
    addRunNode('run-2', { label: 'Deploy', consumes: ['out'] });

    const output = formatRunGraph();
    expect(output).toContain('Run Dependency Graph');
    expect(output).toContain('Build');
    expect(output).toContain('Deploy');
  });
});
