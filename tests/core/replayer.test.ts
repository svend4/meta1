import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { replay } from '../../src/core/replayer.js';
import { hashString, hashObject, computeRunHash } from '../../src/core/hasher.js';
import { LocalSandbox } from '../../src/sandbox/local.js';
import { saveRunSummary } from '../../src/storage/runs.js';
import type { RunSummary } from '../../src/types/run-summary.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';
import * as paths from '../../src/core/paths.js';

// Mock fingerprint capture to avoid slow execSync calls
vi.mock('../../src/core/fingerprint.js', () => ({
  captureDependencyFingerprint: () => ({
    fingerprint_id: 'mock-fp-id',
    captured_at: new Date().toISOString(),
    fingerprint_hash: 'sha256:' + '0'.repeat(64),
    tools: { node: '20.0.0', npm: '10.0.0' },
  }),
  compareDependencyFingerprints: () => [],
}));

let tempDir: string;

function redirectStorage(dir: string) {
  vi.spyOn(paths, 'getBaseDir').mockReturnValue(dir);
  vi.spyOn(paths, 'getRunsDir').mockReturnValue(join(dir, 'runs'));
  vi.spyOn(paths, 'getRunDir').mockImplementation((id) => join(dir, 'runs', id));
  vi.spyOn(paths, 'getEventsPath').mockImplementation((id) => join(dir, 'runs', id, 'events.jsonl'));
  vi.spyOn(paths, 'getSummaryPath').mockImplementation((id) => join(dir, 'runs', id, 'summary.json'));
}

function makePlan(steps: ExecutionPlan['steps']): ExecutionPlan {
  return { plan_id: randomUUID(), description: 'Test plan', steps };
}

function makeSummary(
  runId: string,
  plan: ExecutionPlan,
  stepResults: RunSummary['steps'],
): RunSummary {
  const artifactHashes = stepResults
    .filter((s) => s.artifact_hash)
    .map((s) => s.artifact_hash!);
  return {
    run_id: runId,
    task_id: randomUUID(),
    prompt: 'Test task',
    status: 'completed',
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    duration_ms: 100,
    plan,
    plan_hash: hashObject(plan),
    plan_source: 'llm',
    run_hash: computeRunHash(artifactHashes),
    steps: stepResults,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-replayer-test-'));
  redirectStorage(tempDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('replay', () => {
  it('verifies identical replay of guaranteed create_file steps', async () => {
    const content = 'const x = 42;';
    const plan = makePlan([
      {
        step_id: 'create-index',
        type: 'create_file',
        description: 'Create index.js',
        path: 'index.js',
        content,
        determinism: 'guaranteed',
      },
    ]);

    const originalRunId = randomUUID();
    const originalHash = hashString(content);
    const summary = makeSummary(originalRunId, plan, [
      {
        step_id: 'create-index',
        type: 'create_file',
        status: 'completed',
        artifact_hash: originalHash,
        determinism: 'guaranteed',
      },
    ]);
    saveRunSummary(summary);

    const workspace = join(tempDir, 'replay-ws');
    const sandbox = new LocalSandbox(workspace);

    const result = await replay(originalRunId, sandbox, workspace);

    expect(result.verified).toBe(true);
    expect(result.divergences).toHaveLength(0);
    expect(result.checksPassed).toBe(1);
    expect(result.checksTotal).toBe(1);
    expect(result.summary.status).toBe('completed');
  });

  it('detects divergence in guaranteed step', async () => {
    const plan = makePlan([
      {
        step_id: 'create-file',
        type: 'create_file',
        description: 'Create file',
        path: 'test.txt',
        content: 'new content',
        determinism: 'guaranteed',
      },
    ]);

    const originalRunId = randomUUID();
    // Original had different hash (simulating a changed plan step)
    const summary = makeSummary(originalRunId, plan, [
      {
        step_id: 'create-file',
        type: 'create_file',
        status: 'completed',
        artifact_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        determinism: 'guaranteed',
      },
    ]);
    saveRunSummary(summary);

    const workspace = join(tempDir, 'replay-ws');
    const sandbox = new LocalSandbox(workspace);

    const result = await replay(originalRunId, sandbox, workspace);

    expect(result.verified).toBe(false);
    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0].stepId).toBe('create-file');
    expect(result.divergences[0].expectedHash).toBe(
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    );
    expect(result.divergences[0].actualHash).toBe(hashString('new content'));
  });

  it('best_effort divergence does not break verification', async () => {
    const plan = makePlan([
      {
        step_id: 'cmd-step',
        type: 'run_command',
        description: 'Run command',
        command: 'node',
        args: ['-e', 'console.log(Date.now())'],
        determinism: 'best_effort',
      },
    ]);

    const originalRunId = randomUUID();
    const summary = makeSummary(originalRunId, plan, [
      {
        step_id: 'cmd-step',
        type: 'run_command',
        status: 'completed',
        artifact_hash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        determinism: 'best_effort',
      },
    ]);
    saveRunSummary(summary);

    const workspace = join(tempDir, 'replay-ws');
    const sandbox = new LocalSandbox(workspace);

    const result = await replay(originalRunId, sandbox, workspace);

    // best_effort divergence is noted but verification still passes
    expect(result.verified).toBe(true);
    expect(result.divergences).toHaveLength(1);
    // best_effort divergences still count as "passed" for verification purposes
    expect(result.checksPassed).toBe(1);
  });

  it('replays multi-step plan and verifies all guaranteed steps', async () => {
    const contentA = 'file a content';
    const contentB = 'file b content';
    const plan = makePlan([
      {
        step_id: 'create-a',
        type: 'create_file',
        description: 'Create a.txt',
        path: 'a.txt',
        content: contentA,
        determinism: 'guaranteed',
      },
      {
        step_id: 'create-b',
        type: 'create_file',
        description: 'Create b.txt',
        path: 'b.txt',
        content: contentB,
        determinism: 'guaranteed',
      },
    ]);

    const originalRunId = randomUUID();
    const summary = makeSummary(originalRunId, plan, [
      {
        step_id: 'create-a',
        type: 'create_file',
        status: 'completed',
        artifact_hash: hashString(contentA),
        determinism: 'guaranteed',
      },
      {
        step_id: 'create-b',
        type: 'create_file',
        status: 'completed',
        artifact_hash: hashString(contentB),
        determinism: 'guaranteed',
      },
    ]);
    saveRunSummary(summary);

    const workspace = join(tempDir, 'replay-ws');
    const sandbox = new LocalSandbox(workspace);

    const result = await replay(originalRunId, sandbox, workspace);

    expect(result.verified).toBe(true);
    expect(result.checksPassed).toBe(2);
    expect(result.checksTotal).toBe(2);
    expect(result.divergences).toHaveLength(0);
  });

  it('saves replay run summary to disk', async () => {
    const plan = makePlan([
      {
        step_id: 's1',
        type: 'create_file',
        description: 'Create file',
        path: 'test.txt',
        content: 'test',
        determinism: 'guaranteed',
      },
    ]);

    const originalRunId = randomUUID();
    saveRunSummary(
      makeSummary(originalRunId, plan, [
        {
          step_id: 's1',
          type: 'create_file',
          status: 'completed',
          artifact_hash: hashString('test'),
          determinism: 'guaranteed',
        },
      ]),
    );

    const workspace = join(tempDir, 'replay-ws');
    const result = await replay(originalRunId, new LocalSandbox(workspace), workspace);

    // The replay creates its own run summary
    const replaySummaryPath = join(tempDir, 'runs', result.summary.run_id, 'summary.json');
    const saved = JSON.parse(readFileSync(replaySummaryPath, 'utf8'));
    expect(saved.run_id).toBe(result.summary.run_id);
    expect(saved.run_id).not.toBe(originalRunId);
  });

  it('logs replay_start and replay_verified events', async () => {
    const plan = makePlan([
      {
        step_id: 's1',
        type: 'create_file',
        description: 'File',
        path: 'f.txt',
        content: 'f',
        determinism: 'guaranteed',
      },
    ]);

    const originalRunId = randomUUID();
    saveRunSummary(
      makeSummary(originalRunId, plan, [
        {
          step_id: 's1',
          type: 'create_file',
          status: 'completed',
          artifact_hash: hashString('f'),
          determinism: 'guaranteed',
        },
      ]),
    );

    const workspace = join(tempDir, 'replay-ws');
    const result = await replay(originalRunId, new LocalSandbox(workspace), workspace);

    const eventsPath = join(tempDir, 'runs', result.summary.run_id, 'events.jsonl');
    const events = readFileSync(eventsPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    const types = events.map((e: { type: string }) => e.type);
    expect(types).toContain('replay_start');
    expect(types).toContain('replay_verified');

    const startEvent = events.find((e: { type: string }) => e.type === 'replay_start');
    expect(startEvent.original_run_id).toBe(originalRunId);
  });

  it('logs replay_diverged event on hash mismatch', async () => {
    const plan = makePlan([
      {
        step_id: 'div-step',
        type: 'create_file',
        description: 'File',
        path: 'f.txt',
        content: 'actual content',
        determinism: 'guaranteed',
      },
    ]);

    const originalRunId = randomUUID();
    saveRunSummary(
      makeSummary(originalRunId, plan, [
        {
          step_id: 'div-step',
          type: 'create_file',
          status: 'completed',
          artifact_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
          determinism: 'guaranteed',
        },
      ]),
    );

    const workspace = join(tempDir, 'replay-ws');
    const result = await replay(originalRunId, new LocalSandbox(workspace), workspace);

    const eventsPath = join(tempDir, 'runs', result.summary.run_id, 'events.jsonl');
    const events = readFileSync(eventsPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    const diverged = events.find((e: { type: string }) => e.type === 'replay_diverged');
    expect(diverged).toBeDefined();
    expect(diverged.step_id).toBe('div-step');
    expect(diverged.expected_hash).toBe(
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    );
  });

  it('throws when original run does not exist', async () => {
    const workspace = join(tempDir, 'replay-ws');
    const sandbox = new LocalSandbox(workspace);

    await expect(
      replay('nonexistent-run-id', sandbox, workspace),
    ).rejects.toThrow('Run summary not found');
  });

  it('handles mixed guaranteed and best_effort steps', async () => {
    const fileContent = 'stable';
    const plan = makePlan([
      {
        step_id: 'guaranteed-step',
        type: 'create_file',
        description: 'Guaranteed file',
        path: 'stable.txt',
        content: fileContent,
        determinism: 'guaranteed',
      },
      {
        step_id: 'besteffort-step',
        type: 'run_command',
        description: 'Timestamp command',
        command: 'node',
        args: ['-e', 'console.log(Date.now())'],
        determinism: 'best_effort',
      },
    ]);

    const originalRunId = randomUUID();
    saveRunSummary(
      makeSummary(originalRunId, plan, [
        {
          step_id: 'guaranteed-step',
          type: 'create_file',
          status: 'completed',
          artifact_hash: hashString(fileContent),
          determinism: 'guaranteed',
        },
        {
          step_id: 'besteffort-step',
          type: 'run_command',
          status: 'completed',
          artifact_hash: 'sha256:will-definitely-differ-from-replay',
          determinism: 'best_effort',
        },
      ]),
    );

    const workspace = join(tempDir, 'replay-ws');
    const result = await replay(originalRunId, new LocalSandbox(workspace), workspace);

    // Guaranteed step matches → verified passes
    // best_effort step diverges → noted but doesn't fail
    expect(result.verified).toBe(true);
    expect(result.checksTotal).toBe(2);
    expect(result.checksPassed).toBe(2); // best_effort counts as passed even if diverged
  });
});
