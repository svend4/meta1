import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executePlan } from '../../src/core/executor.js';
import { EventLogger } from '../../src/core/logger.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';
import type { Sandbox } from '../../src/sandbox/types.js';

function makeSandbox(): Sandbox {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('content'),
    exec: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 }),
    getWorkspacePath: vi.fn().mockReturnValue('/tmp/test'),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

describe('step retry', () => {
  let logger: EventLogger;

  beforeEach(() => {
    logger = new EventLogger('retry-run');
  });

  it('succeeds on first attempt without retry config', async () => {
    const sandbox = makeSandbox();
    const plan: ExecutionPlan = {
      plan_id: 'p1',
      steps: [
        {
          step_id: 'cmd1',
          type: 'run_command',
          description: 'Run once',
          command: 'echo',
          args: ['hi'],
          determinism: 'best_effort',
        },
      ],
    };

    const result = await executePlan(plan, sandbox, logger, 'run1');
    expect(result.steps[0].status).toBe('completed');
    expect(sandbox.exec).toHaveBeenCalledTimes(1);
  });

  it('retries a failing command and eventually succeeds', async () => {
    const sandbox = makeSandbox();
    const execMock = sandbox.exec as ReturnType<typeof vi.fn>;
    execMock
      .mockResolvedValueOnce({ stdout: '', stderr: 'fail', exitCode: 1 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'fail', exitCode: 1 })
      .mockResolvedValueOnce({ stdout: 'success', stderr: '', exitCode: 0 });

    const plan: ExecutionPlan = {
      plan_id: 'p2',
      steps: [
        {
          step_id: 'cmd-retry',
          type: 'run_command',
          description: 'Retry command',
          command: 'flaky',
          args: [],
          determinism: 'best_effort',
          retry: { max_attempts: 3, backoff_ms: 10 },
        },
      ],
    };

    const result = await executePlan(plan, sandbox, logger, 'run2');
    expect(result.steps[0].status).toBe('completed');
    expect(execMock).toHaveBeenCalledTimes(3);
  });

  it('fails after all retry attempts exhausted', async () => {
    const sandbox = makeSandbox();
    const execMock = sandbox.exec as ReturnType<typeof vi.fn>;
    execMock.mockResolvedValue({ stdout: '', stderr: 'always fails', exitCode: 1 });

    const plan: ExecutionPlan = {
      plan_id: 'p3',
      steps: [
        {
          step_id: 'cmd-fail',
          type: 'run_command',
          description: 'Always fail',
          command: 'bad',
          args: [],
          determinism: 'best_effort',
          retry: { max_attempts: 2, backoff_ms: 10 },
        },
      ],
    };

    const result = await executePlan(plan, sandbox, logger, 'run3');
    expect(result.steps[0].status).toBe('failed');
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry create_file steps', async () => {
    const sandbox = makeSandbox();
    const plan: ExecutionPlan = {
      plan_id: 'p4',
      steps: [
        {
          step_id: 'file1',
          type: 'create_file',
          description: 'Create file',
          path: 'a.txt',
          content: 'hello',
          determinism: 'guaranteed',
        },
      ],
    };

    const result = await executePlan(plan, sandbox, logger, 'run4');
    expect(result.steps[0].status).toBe('completed');
    expect(sandbox.writeFile).toHaveBeenCalledTimes(1);
  });

  it('applies exponential backoff between retries', async () => {
    const sandbox = makeSandbox();
    const execMock = sandbox.exec as ReturnType<typeof vi.fn>;
    execMock
      .mockResolvedValueOnce({ stdout: '', stderr: 'fail', exitCode: 1 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'fail', exitCode: 1 })
      .mockResolvedValueOnce({ stdout: 'ok', stderr: '', exitCode: 0 });

    const plan: ExecutionPlan = {
      plan_id: 'p5',
      steps: [
        {
          step_id: 'backoff',
          type: 'run_command',
          description: 'Backoff test',
          command: 'test',
          args: [],
          determinism: 'best_effort',
          retry: { max_attempts: 3, backoff_ms: 50 },
        },
      ],
    };

    const start = Date.now();
    const result = await executePlan(plan, sandbox, logger, 'run5');
    const elapsed = Date.now() - start;

    expect(result.steps[0].status).toBe('completed');
    // backoff_ms=50, attempts 2 and 3 wait: 50 + 100 = 150ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it('max_attempts=1 means no retry', async () => {
    const sandbox = makeSandbox();
    (sandbox.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: '', stderr: 'fail', exitCode: 1,
    });

    const plan: ExecutionPlan = {
      plan_id: 'p6',
      steps: [
        {
          step_id: 'no-retry',
          type: 'run_command',
          description: 'No retry',
          command: 'bad',
          args: [],
          determinism: 'best_effort',
          retry: { max_attempts: 1, backoff_ms: 10 },
        },
      ],
    };

    const result = await executePlan(plan, sandbox, logger, 'run6');
    expect(result.steps[0].status).toBe('failed');
    expect(sandbox.exec).toHaveBeenCalledTimes(1);
  });
});
