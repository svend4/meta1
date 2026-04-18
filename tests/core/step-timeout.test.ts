import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executePlan, StepTimeoutError } from '../../src/core/executor.js';
import { EventLogger } from '../../src/core/logger.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';
import type { Sandbox } from '../../src/sandbox/types.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeSandbox(delay = 0): Sandbox {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockImplementation(() =>
      delay > 0
        ? new Promise((resolve) => setTimeout(resolve, delay))
        : Promise.resolve(),
    ),
    readFile: vi.fn().mockResolvedValue('content'),
    exec: vi.fn().mockImplementation(() =>
      delay > 0
        ? new Promise((resolve) =>
            setTimeout(() => resolve({ stdout: 'ok', stderr: '', exitCode: 0 }), delay),
          )
        : Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 }),
    ),
    getWorkspacePath: vi.fn().mockReturnValue('/tmp/test'),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

function makePlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    plan_id: 'test-plan',
    steps: [
      {
        step_id: 'step1',
        type: 'create_file',
        description: 'Create file',
        path: 'test.txt',
        content: 'hello',
        determinism: 'guaranteed' as const,
      },
    ],
    ...overrides,
  };
}

describe('step timeouts', () => {
  let logDir: string;
  let logger: EventLogger;

  beforeEach(() => {
    logDir = mkdtempSync(join(tmpdir(), 'timeout-test-'));
    const runId = 'timeout-run';
    logger = new EventLogger(runId);
  });

  it('completes steps within timeout', async () => {
    const sandbox = makeSandbox(10);
    const plan = makePlan({
      steps: [
        {
          step_id: 's1',
          type: 'create_file',
          description: 'Fast file',
          path: 'a.txt',
          content: 'hi',
          determinism: 'guaranteed',
          timeout_ms: 5000,
        },
      ],
    });

    const result = await executePlan(plan, sandbox, logger, 'run1');
    expect(result.steps[0].status).toBe('completed');
  });

  it('fails step that exceeds per-step timeout_ms', async () => {
    const sandbox = makeSandbox(500);
    const plan = makePlan({
      steps: [
        {
          step_id: 'slow',
          type: 'create_file',
          description: 'Slow file',
          path: 'slow.txt',
          content: 'data',
          determinism: 'guaranteed',
          timeout_ms: 50,
        },
      ],
    });

    const result = await executePlan(plan, sandbox, logger, 'run2');
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].error).toContain('timed out');
  });

  it('uses defaultTimeoutMs from ExecutionOptions', async () => {
    const sandbox = makeSandbox(500);
    const plan = makePlan({
      steps: [
        {
          step_id: 'slow2',
          type: 'create_file',
          description: 'Slow file',
          path: 'slow.txt',
          content: 'data',
          determinism: 'guaranteed',
        },
      ],
    });

    const result = await executePlan(plan, sandbox, logger, 'run3', {
      defaultTimeoutMs: 50,
    });
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].error).toContain('timed out');
  });

  it('per-step timeout overrides default timeout', async () => {
    const sandbox = makeSandbox(100);
    const plan = makePlan({
      steps: [
        {
          step_id: 'overridden',
          type: 'create_file',
          description: 'File with long per-step timeout',
          path: 'a.txt',
          content: 'hi',
          determinism: 'guaranteed',
          timeout_ms: 5000,
        },
      ],
    });

    const result = await executePlan(plan, sandbox, logger, 'run4', {
      defaultTimeoutMs: 10,
    });
    expect(result.steps[0].status).toBe('completed');
  });

  it('StepTimeoutError has correct fields', () => {
    const err = new StepTimeoutError('my-step', 3000);
    expect(err.name).toBe('StepTimeoutError');
    expect(err.stepId).toBe('my-step');
    expect(err.timeoutMs).toBe(3000);
    expect(err.message).toContain('my-step');
    expect(err.message).toContain('3000ms');
  });

  it('timeout works in parallel mode', async () => {
    const sandbox = makeSandbox(500);
    const plan = makePlan({
      execution_mode: 'parallel',
      steps: [
        {
          step_id: 'p1',
          type: 'create_file',
          description: 'Parallel slow step',
          path: 'p.txt',
          content: 'data',
          determinism: 'guaranteed',
          timeout_ms: 50,
        },
      ],
    });

    const result = await executePlan(plan, sandbox, logger, 'run5');
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].error).toContain('timed out');
  });
});
