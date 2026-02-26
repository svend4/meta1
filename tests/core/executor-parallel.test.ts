import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { executePlan, buildDependencyGraph } from '../../src/core/executor.js';
import { EventLogger } from '../../src/core/logger.js';
import { hashString } from '../../src/core/hasher.js';
import { LocalSandbox } from '../../src/sandbox/local.js';
import type { ExecutionPlan, Step } from '../../src/types/execution-plan.js';
import * as paths from '../../src/core/paths.js';

let tempDir: string;
let workspaceDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-parallel-test-'));
  workspaceDir = join(tempDir, 'workspace');

  vi.spyOn(paths, 'getBaseDir').mockReturnValue(tempDir);
  vi.spyOn(paths, 'getRunsDir').mockReturnValue(join(tempDir, 'runs'));
  vi.spyOn(paths, 'getRunDir').mockImplementation((id) => join(tempDir, 'runs', id));
  vi.spyOn(paths, 'getEventsPath').mockImplementation((id) => join(tempDir, 'runs', id, 'events.jsonl'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

function makePlan(steps: Step[], mode?: 'sequential' | 'parallel'): ExecutionPlan {
  return {
    plan_id: randomUUID(),
    description: 'Parallel test plan',
    steps,
    execution_mode: mode,
  };
}

describe('buildDependencyGraph', () => {
  it('builds graph for independent steps', () => {
    const steps: Step[] = [
      { step_id: 'a', type: 'create_file', description: '', path: 'a.txt', content: 'a', determinism: 'guaranteed' },
      { step_id: 'b', type: 'create_file', description: '', path: 'b.txt', content: 'b', determinism: 'guaranteed' },
    ];

    const { inDegree } = buildDependencyGraph(steps);
    expect(inDegree.get('a')).toBe(0);
    expect(inDegree.get('b')).toBe(0);
  });

  it('builds graph with dependencies', () => {
    const steps: Step[] = [
      { step_id: 'a', type: 'create_file', description: '', path: 'a.txt', content: 'a', determinism: 'guaranteed' },
      { step_id: 'b', type: 'create_file', description: '', path: 'b.txt', content: 'b', determinism: 'guaranteed', depends_on: ['a'] },
      { step_id: 'c', type: 'create_file', description: '', path: 'c.txt', content: 'c', determinism: 'guaranteed', depends_on: ['a', 'b'] },
    ];

    const { inDegree, dependents } = buildDependencyGraph(steps);
    expect(inDegree.get('a')).toBe(0);
    expect(inDegree.get('b')).toBe(1);
    expect(inDegree.get('c')).toBe(2);
    expect(dependents.get('a')).toContain('b');
    expect(dependents.get('a')).toContain('c');
    expect(dependents.get('b')).toContain('c');
  });

  it('throws on unknown dependency', () => {
    const steps: Step[] = [
      { step_id: 'a', type: 'create_file', description: '', path: 'a.txt', content: 'a', determinism: 'guaranteed', depends_on: ['nonexistent'] },
    ];
    expect(() => buildDependencyGraph(steps)).toThrow(/unknown step/);
  });

  it('throws on self-dependency', () => {
    const steps: Step[] = [
      { step_id: 'a', type: 'create_file', description: '', path: 'a.txt', content: 'a', determinism: 'guaranteed', depends_on: ['a'] },
    ];
    expect(() => buildDependencyGraph(steps)).toThrow(/depend on itself/);
  });

  it('throws on cyclic dependency', () => {
    const steps: Step[] = [
      { step_id: 'a', type: 'create_file', description: '', path: 'a.txt', content: 'a', determinism: 'guaranteed', depends_on: ['b'] },
      { step_id: 'b', type: 'create_file', description: '', path: 'b.txt', content: 'b', determinism: 'guaranteed', depends_on: ['a'] },
    ];
    expect(() => buildDependencyGraph(steps)).toThrow(/cycle/i);
  });

  it('detects cycles in longer chains', () => {
    const steps: Step[] = [
      { step_id: 'a', type: 'create_file', description: '', path: 'a.txt', content: 'a', determinism: 'guaranteed', depends_on: ['c'] },
      { step_id: 'b', type: 'create_file', description: '', path: 'b.txt', content: 'b', determinism: 'guaranteed', depends_on: ['a'] },
      { step_id: 'c', type: 'create_file', description: '', path: 'c.txt', content: 'c', determinism: 'guaranteed', depends_on: ['b'] },
    ];
    expect(() => buildDependencyGraph(steps)).toThrow(/cycle/i);
  });
});

describe('executePlan — parallel mode', () => {
  it('executes independent steps concurrently', async () => {
    const plan = makePlan([
      { step_id: 'a', type: 'create_file', description: 'Create a', path: 'a.txt', content: 'aaa', determinism: 'guaranteed' },
      { step_id: 'b', type: 'create_file', description: 'Create b', path: 'b.txt', content: 'bbb', determinism: 'guaranteed' },
      { step_id: 'c', type: 'create_file', description: 'Create c', path: 'c.txt', content: 'ccc', determinism: 'guaranteed' },
    ], 'parallel');

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);

    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((s) => s.status === 'completed')).toBe(true);
    expect(result.artifactHashes).toHaveLength(3);

    // Verify all files created
    expect(readFileSync(join(workspaceDir, 'a.txt'), 'utf8')).toBe('aaa');
    expect(readFileSync(join(workspaceDir, 'b.txt'), 'utf8')).toBe('bbb');
    expect(readFileSync(join(workspaceDir, 'c.txt'), 'utf8')).toBe('ccc');
  });

  it('respects dependency ordering', async () => {
    // b depends on a: a must complete before b starts
    const plan = makePlan([
      { step_id: 'a', type: 'create_file', description: 'Create a', path: 'a.txt', content: 'aaa', determinism: 'guaranteed' },
      { step_id: 'b', type: 'run_command', description: 'Read a and write b', command: 'node', args: ['-e', 'const fs=require("fs"); const a=fs.readFileSync("a.txt","utf8"); fs.writeFileSync("b.txt", a+"bbb")'], determinism: 'guaranteed', depends_on: ['a'] },
    ], 'parallel');

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);

    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[1].status).toBe('completed');

    // b should have read a.txt and concatenated
    const bContent = readFileSync(join(workspaceDir, 'b.txt'), 'utf8');
    expect(bContent).toBe('aaabbb');
  });

  it('skips dependent steps when dependency fails', async () => {
    const plan = makePlan([
      { step_id: 'a', type: 'run_command', description: 'Fail', command: 'node', args: ['-e', 'process.exit(1)'], determinism: 'best_effort' },
      { step_id: 'b', type: 'create_file', description: 'Depends on a', path: 'b.txt', content: 'bbb', determinism: 'guaranteed', depends_on: ['a'] },
      { step_id: 'c', type: 'create_file', description: 'Independent', path: 'c.txt', content: 'ccc', determinism: 'guaranteed' },
    ], 'parallel');

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);

    const resultA = result.steps.find((s) => s.step_id === 'a')!;
    const resultB = result.steps.find((s) => s.step_id === 'b')!;
    const resultC = result.steps.find((s) => s.step_id === 'c')!;

    expect(resultA.status).toBe('failed');
    expect(resultB.status).toBe('skipped');
    expect(resultC.status).toBe('completed'); // independent, not affected

    // c.txt created, b.txt not
    expect(readFileSync(join(workspaceDir, 'c.txt'), 'utf8')).toBe('ccc');
    expect(existsSync(join(workspaceDir, 'b.txt'))).toBe(false);
  });

  it('handles diamond dependency pattern', async () => {
    //    a
    //   / \
    //  b   c
    //   \ /
    //    d
    const plan = makePlan([
      { step_id: 'a', type: 'create_file', description: 'Root', path: 'a.txt', content: 'A', determinism: 'guaranteed' },
      { step_id: 'b', type: 'create_file', description: 'Left', path: 'b.txt', content: 'B', determinism: 'guaranteed', depends_on: ['a'] },
      { step_id: 'c', type: 'create_file', description: 'Right', path: 'c.txt', content: 'C', determinism: 'guaranteed', depends_on: ['a'] },
      { step_id: 'd', type: 'create_file', description: 'Merge', path: 'd.txt', content: 'D', determinism: 'guaranteed', depends_on: ['b', 'c'] },
    ], 'parallel');

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);

    expect(result.steps).toHaveLength(4);
    expect(result.steps.every((s) => s.status === 'completed')).toBe(true);
    expect(result.artifactHashes).toHaveLength(4);
  });

  it('returns results in plan order regardless of execution order', async () => {
    const plan = makePlan([
      { step_id: 'z', type: 'create_file', description: 'Z first in plan', path: 'z.txt', content: 'z', determinism: 'guaranteed' },
      { step_id: 'a', type: 'create_file', description: 'A second in plan', path: 'a.txt', content: 'a', determinism: 'guaranteed' },
    ], 'parallel');

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);

    // Results should be in plan order: z then a
    expect(result.steps[0].step_id).toBe('z');
    expect(result.steps[1].step_id).toBe('a');
  });

  it('logs events for each step in parallel mode', async () => {
    const plan = makePlan([
      { step_id: 'x', type: 'create_file', description: 'X', path: 'x.txt', content: 'x', determinism: 'guaranteed' },
      { step_id: 'y', type: 'create_file', description: 'Y', path: 'y.txt', content: 'y', determinism: 'guaranteed' },
    ], 'parallel');

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    await executePlan(plan, sandbox, logger, runId);

    const logContent = readFileSync(logger.getPath(), 'utf8');
    const events = logContent.trim().split('\n').map((l) => JSON.parse(l));
    const types = events.map((e: { type: string }) => e.type);

    // Both steps should have start, complete, artifact_hashed
    const startEvents = events.filter((e: { type: string }) => e.type === 'step_start');
    const completeEvents = events.filter((e: { type: string }) => e.type === 'step_complete');

    expect(startEvents).toHaveLength(2);
    expect(completeEvents).toHaveLength(2);
  });

  it('propagates failure through dependency chain', async () => {
    // a fails → b skipped → c skipped (b→c dependency)
    const plan = makePlan([
      { step_id: 'a', type: 'run_command', description: 'Fail', command: 'node', args: ['-e', 'process.exit(1)'], determinism: 'best_effort' },
      { step_id: 'b', type: 'create_file', description: 'Dep A', path: 'b.txt', content: 'b', determinism: 'guaranteed', depends_on: ['a'] },
      { step_id: 'c', type: 'create_file', description: 'Dep B', path: 'c.txt', content: 'c', determinism: 'guaranteed', depends_on: ['b'] },
    ], 'parallel');

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);

    expect(result.steps.find((s) => s.step_id === 'a')!.status).toBe('failed');
    expect(result.steps.find((s) => s.step_id === 'b')!.status).toBe('skipped');
    expect(result.steps.find((s) => s.step_id === 'c')!.status).toBe('skipped');
  });

  it('still works in sequential mode (default)', async () => {
    const plan = makePlan([
      { step_id: 'a', type: 'create_file', description: 'A', path: 'a.txt', content: 'a', determinism: 'guaranteed' },
      { step_id: 'b', type: 'create_file', description: 'B', path: 'b.txt', content: 'b', determinism: 'guaranteed' },
    ]); // no mode = sequential

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);

    expect(result.steps).toHaveLength(2);
    expect(result.steps.every((s) => s.status === 'completed')).toBe(true);
  });

  it('preserves artifact hashes for completed steps only', async () => {
    const plan = makePlan([
      { step_id: 'ok', type: 'create_file', description: 'OK', path: 'ok.txt', content: 'ok', determinism: 'guaranteed' },
      { step_id: 'fail', type: 'run_command', description: 'Fail', command: 'node', args: ['-e', 'process.exit(1)'], determinism: 'best_effort' },
      { step_id: 'dep', type: 'create_file', description: 'Dep on fail', path: 'dep.txt', content: 'dep', determinism: 'guaranteed', depends_on: ['fail'] },
    ], 'parallel');

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);

    // Only 'ok' should have an artifact hash
    expect(result.artifactHashes).toHaveLength(1);
    expect(result.artifactHashes[0]).toBe(hashString('ok'));
  });
});
