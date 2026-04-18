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
    exec: vi.fn().mockResolvedValue({ stdout: 'hello world', stderr: 'warn', exitCode: 0 }),
    getWorkspacePath: vi.fn().mockReturnValue('/tmp/test'),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

describe('step output capture', () => {
  let logger: EventLogger;

  beforeEach(() => {
    logger = new EventLogger('capture-run');
  });

  it('captures stdout and stderr when capture_output is true', async () => {
    const sandbox = makeSandbox();
    const plan: ExecutionPlan = {
      plan_id: 'p1',
      steps: [
        {
          step_id: 'cmd1',
          type: 'run_command',
          description: 'Capture output',
          command: 'echo',
          args: ['hello'],
          determinism: 'best_effort',
          capture_output: true,
        },
      ],
    };

    const result = await executePlan(plan, sandbox, logger, 'run1');
    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[0].stdout).toBe('hello world');
    expect(result.steps[0].stderr).toBe('warn');
  });

  it('does not capture output when capture_output is false', async () => {
    const sandbox = makeSandbox();
    const plan: ExecutionPlan = {
      plan_id: 'p2',
      steps: [
        {
          step_id: 'cmd2',
          type: 'run_command',
          description: 'No capture',
          command: 'echo',
          args: ['hello'],
          determinism: 'best_effort',
          capture_output: false,
        },
      ],
    };

    const result = await executePlan(plan, sandbox, logger, 'run2');
    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[0].stdout).toBeUndefined();
    expect(result.steps[0].stderr).toBeUndefined();
  });

  it('does not capture output by default', async () => {
    const sandbox = makeSandbox();
    const plan: ExecutionPlan = {
      plan_id: 'p3',
      steps: [
        {
          step_id: 'cmd3',
          type: 'run_command',
          description: 'Default',
          command: 'echo',
          args: ['hello'],
          determinism: 'best_effort',
        },
      ],
    };

    const result = await executePlan(plan, sandbox, logger, 'run3');
    expect(result.steps[0].stdout).toBeUndefined();
  });

  it('captures output in parallel mode', async () => {
    const sandbox = makeSandbox();
    const plan: ExecutionPlan = {
      plan_id: 'p4',
      execution_mode: 'parallel',
      steps: [
        {
          step_id: 'cmd4',
          type: 'run_command',
          description: 'Parallel capture',
          command: 'echo',
          args: ['parallel'],
          determinism: 'best_effort',
          capture_output: true,
        },
      ],
    };

    const result = await executePlan(plan, sandbox, logger, 'run4');
    expect(result.steps[0].stdout).toBe('hello world');
    expect(result.steps[0].stderr).toBe('warn');
  });

  it('create_file steps do not have output fields', async () => {
    const sandbox = makeSandbox();
    const plan: ExecutionPlan = {
      plan_id: 'p5',
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

    const result = await executePlan(plan, sandbox, logger, 'run5');
    expect(result.steps[0].stdout).toBeUndefined();
    expect(result.steps[0].stderr).toBeUndefined();
  });
});
