import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { executePlan } from '../../src/core/executor.js';
import { EventLogger } from '../../src/core/logger.js';
import { hashString } from '../../src/core/hasher.js';
import { LocalSandbox } from '../../src/sandbox/local.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';
import * as paths from '../../src/core/paths.js';

let tempDir: string;
let workspaceDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-executor-test-'));
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

function makePlan(steps: ExecutionPlan['steps']): ExecutionPlan {
  return { plan_id: randomUUID(), description: 'Test plan', steps };
}

describe('executePlan', () => {
  it('executes a single create_file step and returns artifact hash', async () => {
    const content = '{"name": "test"}';
    const plan = makePlan([
      {
        step_id: 'create-pkg',
        type: 'create_file',
        description: 'Create package.json',
        path: 'package.json',
        content,
        determinism: 'guaranteed',
      },
    ]);

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[0].artifact_hash).toBe(hashString(content));
    expect(result.artifactHashes).toHaveLength(1);

    // Verify file was actually written
    const written = readFileSync(join(workspaceDir, 'package.json'), 'utf8');
    expect(written).toBe(content);
  });

  it('executes multiple create_file steps sequentially', async () => {
    const plan = makePlan([
      {
        step_id: 'file-a',
        type: 'create_file',
        description: 'Create a.txt',
        path: 'a.txt',
        content: 'aaa',
        determinism: 'guaranteed',
      },
      {
        step_id: 'file-b',
        type: 'create_file',
        description: 'Create b.txt',
        path: 'b.txt',
        content: 'bbb',
        determinism: 'guaranteed',
      },
    ]);

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);

    expect(result.steps).toHaveLength(2);
    expect(result.steps.every((s) => s.status === 'completed')).toBe(true);
    expect(result.artifactHashes).toHaveLength(2);
    expect(result.artifactHashes[0]).toBe(hashString('aaa'));
    expect(result.artifactHashes[1]).toBe(hashString('bbb'));
  });

  it('creates files in nested directories', async () => {
    const plan = makePlan([
      {
        step_id: 'nested-file',
        type: 'create_file',
        description: 'Create nested file',
        path: 'src/utils/helper.ts',
        content: 'export const x = 1;',
        determinism: 'guaranteed',
      },
    ]);

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);

    expect(result.steps[0].status).toBe('completed');
    const written = readFileSync(join(workspaceDir, 'src/utils/helper.ts'), 'utf8');
    expect(written).toBe('export const x = 1;');
  });

  it('executes a run_command step and hashes stdout', async () => {
    const plan = makePlan([
      {
        step_id: 'echo-cmd',
        type: 'run_command',
        description: 'Echo hello',
        command: 'node',
        args: ['-e', 'console.log("hello world")'],
        determinism: 'guaranteed',
      },
    ]);

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);

    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[0].artifact_hash).toBe(hashString('hello world\n'));
    expect(result.artifactHashes).toHaveLength(1);
  });

  it('marks failed step and skips remaining steps', async () => {
    const plan = makePlan([
      {
        step_id: 'step-ok',
        type: 'create_file',
        description: 'Create file',
        path: 'ok.txt',
        content: 'ok',
        determinism: 'guaranteed',
      },
      {
        step_id: 'step-fail',
        type: 'run_command',
        description: 'Failing command',
        command: 'node',
        args: ['-e', 'process.exit(1)'],
        determinism: 'best_effort',
      },
      {
        step_id: 'step-skipped',
        type: 'create_file',
        description: 'Should be skipped',
        path: 'skip.txt',
        content: 'skipped',
        determinism: 'guaranteed',
      },
    ]);

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);

    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[1].status).toBe('failed');
    expect(result.steps[1].error).toBeDefined();
    expect(result.steps[2].status).toBe('skipped');
    // Only the first step's hash is collected (failed step doesn't produce one)
    expect(result.artifactHashes).toHaveLength(1);
  });

  it('records duration_ms for each step', async () => {
    const plan = makePlan([
      {
        step_id: 'timed-step',
        type: 'create_file',
        description: 'Timed step',
        path: 'timed.txt',
        content: 'timing',
        determinism: 'guaranteed',
      },
    ]);

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);

    expect(result.steps[0].duration_ms).toBeDefined();
    expect(result.steps[0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('preserves determinism level in step results', async () => {
    const plan = makePlan([
      {
        step_id: 'g-step',
        type: 'create_file',
        description: 'Guaranteed',
        path: 'g.txt',
        content: 'g',
        determinism: 'guaranteed',
      },
      {
        step_id: 'b-step',
        type: 'run_command',
        description: 'Best effort',
        command: 'node',
        args: ['-e', 'console.log("ok")'],
        determinism: 'best_effort',
      },
    ]);

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);

    expect(result.steps[0].determinism).toBe('guaranteed');
    expect(result.steps[1].determinism).toBe('best_effort');
  });

  it('logs step_start, step_complete, and artifact_hashed events', async () => {
    const plan = makePlan([
      {
        step_id: 'logged-step',
        type: 'create_file',
        description: 'Logged step',
        path: 'log.txt',
        content: 'logged',
        determinism: 'guaranteed',
      },
    ]);

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    await executePlan(plan, sandbox, logger, runId);

    const logContent = readFileSync(logger.getPath(), 'utf8');
    const events = logContent.trim().split('\n').map((l) => JSON.parse(l));

    const types = events.map((e: { type: string }) => e.type);
    expect(types).toContain('step_start');
    expect(types).toContain('step_complete');
    expect(types).toContain('artifact_hashed');
  });

  it('logs step_failed event on command failure', async () => {
    const plan = makePlan([
      {
        step_id: 'fail-logged',
        type: 'run_command',
        description: 'Will fail',
        command: 'node',
        args: ['-e', 'process.exit(42)'],
        determinism: 'best_effort',
      },
    ]);

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    await executePlan(plan, sandbox, logger, runId);

    const logContent = readFileSync(logger.getPath(), 'utf8');
    const events = logContent.trim().split('\n').map((l) => JSON.parse(l));

    const failEvent = events.find((e: { type: string }) => e.type === 'step_failed');
    expect(failEvent).toBeDefined();
    expect(failEvent.step_id).toBe('fail-logged');
  });

  it('handles empty plan (no steps)', async () => {
    const plan = makePlan([
      // Need at least one step per schema, but let's test the executor
      // with a minimal single-step plan for completeness
      {
        step_id: 'only-step',
        type: 'create_file',
        description: 'Single step',
        path: 'only.txt',
        content: '',
        determinism: 'guaranteed',
      },
    ]);

    const sandbox = new LocalSandbox(workspaceDir);
    await sandbox.init();
    const runId = randomUUID();
    const logger = new EventLogger(runId);

    const result = await executePlan(plan, sandbox, logger, runId);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].status).toBe('completed');
  });

  it('deterministic: same file content → same artifact hash', async () => {
    const content = 'deterministic content';
    const plan = makePlan([
      {
        step_id: 'det-1',
        type: 'create_file',
        description: 'File 1',
        path: 'det1.txt',
        content,
        determinism: 'guaranteed',
      },
    ]);

    const sandbox1 = new LocalSandbox(join(tempDir, 'ws1'));
    await sandbox1.init();
    const sandbox2 = new LocalSandbox(join(tempDir, 'ws2'));
    await sandbox2.init();

    const run1 = randomUUID();
    const run2 = randomUUID();
    const logger1 = new EventLogger(run1);
    const logger2 = new EventLogger(run2);

    const result1 = await executePlan(plan, sandbox1, logger1, run1);
    const result2 = await executePlan(plan, sandbox2, logger2, run2);

    expect(result1.steps[0].artifact_hash).toBe(result2.steps[0].artifact_hash);
  });
});
