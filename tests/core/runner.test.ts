import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { run, executeFromFile } from '../../src/core/runner.js';
import { hashString, hashObject } from '../../src/core/hasher.js';
import { LocalSandbox } from '../../src/sandbox/local.js';
import type { TaskSpec } from '../../src/types/task-spec.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';
import * as paths from '../../src/core/paths.js';
import { writeFileSync, mkdirSync } from 'node:fs';

// Mock LLM — we never call Anthropic in tests
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

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
  vi.spyOn(paths, 'getPlanCacheDir').mockReturnValue(join(dir, 'cache', 'plans'));
  vi.spyOn(paths, 'getCachedPlanPath').mockImplementation((key: string) => {
    const hex = key.replace('sha256:', '');
    return join(dir, 'cache', 'plans', `${hex}.json`);
  });
}

function makeTask(overrides?: Partial<TaskSpec>): TaskSpec {
  return {
    task_id: randomUUID(),
    prompt: 'Create a hello world app',
    model: 'claude-sonnet-4-20250514',
    ...overrides,
  };
}

function makeValidPlanJson(): string {
  return JSON.stringify({
    plan_id: randomUUID(),
    description: 'Hello world app',
    steps: [
      {
        step_id: 'create-index',
        type: 'create_file',
        description: 'Create index.js',
        path: 'index.js',
        content: 'console.log("hello");',
        determinism: 'guaranteed',
      },
    ],
  });
}

function mockLLM(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
    model: 'claude-sonnet-4-20250514',
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-runner-test-'));
  redirectStorage(tempDir);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('run (full pipeline)', () => {
  it('plans via LLM, executes, and returns completed summary', async () => {
    mockLLM(makeValidPlanJson());
    const task = makeTask();
    const workspace = join(tempDir, 'ws', randomUUID());
    const sandbox = new LocalSandbox(workspace);

    const summary = await run(task, sandbox, { workspace });

    expect(summary.status).toBe('completed');
    expect(summary.plan_source).toBe('llm');
    expect(summary.steps).toHaveLength(1);
    expect(summary.steps[0].status).toBe('completed');
    expect(summary.plan_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(summary.run_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(summary.run_id).toBeDefined();
    expect(summary.prompt).toBe(task.prompt);
  });

  it('saves run summary to disk', async () => {
    mockLLM(makeValidPlanJson());
    const task = makeTask();
    const workspace = join(tempDir, 'ws', randomUUID());
    const sandbox = new LocalSandbox(workspace);

    const summary = await run(task, sandbox, { workspace });

    const summaryPath = join(tempDir, 'runs', summary.run_id, 'summary.json');
    expect(existsSync(summaryPath)).toBe(true);
    const saved = JSON.parse(readFileSync(summaryPath, 'utf8'));
    expect(saved.run_id).toBe(summary.run_id);
  });

  it('writes events.jsonl with run lifecycle events', async () => {
    mockLLM(makeValidPlanJson());
    const task = makeTask();
    const workspace = join(tempDir, 'ws', randomUUID());
    const sandbox = new LocalSandbox(workspace);

    const summary = await run(task, sandbox, { workspace });

    const eventsPath = join(tempDir, 'runs', summary.run_id, 'events.jsonl');
    const events = readFileSync(eventsPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    const types = events.map((e: { type: string }) => e.type);
    expect(types).toContain('run_start');
    expect(types).toContain('plan_generated');
    expect(types).toContain('step_start');
    expect(types).toContain('step_complete');
    expect(types).toContain('artifact_hashed');
    expect(types).toContain('run_complete');
  });

  it('uses cached plan on second run with same prompt', async () => {
    const planJson = makeValidPlanJson();
    mockLLM(planJson);

    const task = makeTask();
    const ws1 = join(tempDir, 'ws1');
    const ws2 = join(tempDir, 'ws2');

    // First run — should call LLM and cache
    const summary1 = await run(task, new LocalSandbox(ws1), {
      workspace: ws1,
      useCache: true,
    });
    expect(summary1.plan_source).toBe('llm');
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // Second run — same task, should hit cache
    const summary2 = await run(task, new LocalSandbox(ws2), {
      workspace: ws2,
      useCache: true,
    });
    expect(summary2.plan_source).toBe('cache');
    expect(mockCreate).toHaveBeenCalledTimes(1); // no additional LLM call
  });

  it('logs plan_cache_hit event on cache hit', async () => {
    mockLLM(makeValidPlanJson());
    const task = makeTask();

    const ws1 = join(tempDir, 'ws1');
    await run(task, new LocalSandbox(ws1), { workspace: ws1, useCache: true });

    const ws2 = join(tempDir, 'ws2');
    const summary2 = await run(task, new LocalSandbox(ws2), { workspace: ws2, useCache: true });

    const eventsPath = join(tempDir, 'runs', summary2.run_id, 'events.jsonl');
    const events = readFileSync(eventsPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    const cacheHit = events.find((e: { type: string }) => e.type === 'plan_cache_hit');
    expect(cacheHit).toBeDefined();
  });

  it('skips cache when useCache is false', async () => {
    const planJson = makeValidPlanJson();
    mockLLM(planJson);
    mockLLM(planJson); // need two LLM responses

    const task = makeTask();

    const ws1 = join(tempDir, 'ws1');
    await run(task, new LocalSandbox(ws1), { workspace: ws1, useCache: false });

    const ws2 = join(tempDir, 'ws2');
    await run(task, new LocalSandbox(ws2), { workspace: ws2, useCache: false });

    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('fails with cacheOnly when no cached plan exists', async () => {
    const task = makeTask({ prompt: 'unique prompt no cache' });
    const workspace = join(tempDir, 'ws');
    const sandbox = new LocalSandbox(workspace);

    await expect(
      run(task, sandbox, { workspace, cacheOnly: true }),
    ).rejects.toThrow('No cached plan found');
  });

  it('reports failed status when a step fails', async () => {
    const failPlan = JSON.stringify({
      plan_id: randomUUID(),
      description: 'Plan with failing step',
      steps: [
        {
          step_id: 'will-fail',
          type: 'run_command',
          description: 'Exit with error',
          command: 'node',
          args: ['-e', 'process.exit(1)'],
          determinism: 'best_effort',
        },
      ],
    });
    mockLLM(failPlan);

    const task = makeTask();
    const workspace = join(tempDir, 'ws');
    const sandbox = new LocalSandbox(workspace);

    const summary = await run(task, sandbox, { workspace, useCache: false });

    expect(summary.status).toBe('failed');
    expect(summary.steps[0].status).toBe('failed');
    expect(summary.run_hash).toBeUndefined();
  });

  it('attaches planner_signature from LLM to the plan', async () => {
    mockLLM(makeValidPlanJson());
    const task = makeTask();
    const workspace = join(tempDir, 'ws');
    const sandbox = new LocalSandbox(workspace);

    const summary = await run(task, sandbox, { workspace, useCache: false });

    expect(summary.plan.planner_signature).toBeDefined();
    expect(summary.plan.planner_signature!.planner_model).toBe('claude-sonnet-4-20250514');
  });
});

describe('executeFromFile', () => {
  it('executes a valid plan file and returns completed summary', async () => {
    const plan: ExecutionPlan = {
      plan_id: randomUUID(),
      description: 'File-based plan',
      steps: [
        {
          step_id: 'file-step',
          type: 'create_file',
          description: 'Create hello.txt',
          path: 'hello.txt',
          content: 'hello from file plan',
          determinism: 'guaranteed',
        },
      ],
    };

    const planPath = join(tempDir, 'test-plan.json');
    writeFileSync(planPath, JSON.stringify(plan), 'utf8');

    const workspace = join(tempDir, 'ws');
    const sandbox = new LocalSandbox(workspace);

    const summary = await executeFromFile(planPath, sandbox, { workspace });

    expect(summary.status).toBe('completed');
    expect(summary.plan_source).toBe('file');
    expect(summary.task_id).toBe('manual');
    expect(summary.steps[0].status).toBe('completed');
    expect(mockCreate).not.toHaveBeenCalled(); // no LLM call
  });

  it('logs plan_loaded event with source file', async () => {
    const plan: ExecutionPlan = {
      plan_id: randomUUID(),
      steps: [
        {
          step_id: 's1',
          type: 'create_file',
          description: 'Create file',
          path: 'test.txt',
          content: 'test',
          determinism: 'guaranteed',
        },
      ],
    };

    const planPath = join(tempDir, 'plan.json');
    writeFileSync(planPath, JSON.stringify(plan), 'utf8');

    const workspace = join(tempDir, 'ws');
    const summary = await executeFromFile(planPath, new LocalSandbox(workspace), { workspace });

    const eventsPath = join(tempDir, 'runs', summary.run_id, 'events.jsonl');
    const events = readFileSync(eventsPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    const loaded = events.find((e: { type: string }) => e.type === 'plan_loaded');
    expect(loaded).toBeDefined();
    expect(loaded.source).toBe('file');
    expect(loaded.path).toBe(planPath);
  });

  it('throws on invalid plan JSON file', async () => {
    const planPath = join(tempDir, 'bad-plan.json');
    writeFileSync(planPath, JSON.stringify({ invalid: true }), 'utf8');

    const workspace = join(tempDir, 'ws');
    const sandbox = new LocalSandbox(workspace);

    await expect(
      executeFromFile(planPath, sandbox, { workspace }),
    ).rejects.toThrow('Invalid ExecutionPlan');
  });

  it('works without planner_signature (manual plan)', async () => {
    const plan: ExecutionPlan = {
      plan_id: randomUUID(),
      steps: [
        {
          step_id: 'manual-step',
          type: 'create_file',
          description: 'Manual file',
          path: 'manual.txt',
          content: 'manually planned',
          determinism: 'guaranteed',
        },
      ],
    };

    const planPath = join(tempDir, 'manual-plan.json');
    writeFileSync(planPath, JSON.stringify(plan), 'utf8');

    const workspace = join(tempDir, 'ws');
    const summary = await executeFromFile(planPath, new LocalSandbox(workspace), { workspace });

    expect(summary.status).toBe('completed');
    expect(summary.plan.planner_signature).toBeUndefined();
  });
});
