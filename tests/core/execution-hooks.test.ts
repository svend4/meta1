import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executePlan } from '../../src/core/executor.js';
import type { ExecutionHooks, ProgressEvent } from '../../src/core/executor.js';
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

function makePlan(steps = 2): ExecutionPlan {
  return {
    plan_id: 'hook-plan',
    steps: Array.from({ length: steps }, (_, i) => ({
      step_id: `step${i + 1}`,
      type: 'create_file' as const,
      description: `Create file ${i + 1}`,
      path: `file${i + 1}.txt`,
      content: `content ${i + 1}`,
      determinism: 'guaranteed' as const,
    })),
  };
}

describe('execution hooks', () => {
  let logger: EventLogger;

  beforeEach(() => {
    logger = new EventLogger('hook-run');
  });

  it('calls onStepStart for each step', async () => {
    const hooks: ExecutionHooks = {
      onStepStart: vi.fn(),
    };

    await executePlan(makePlan(3), makeSandbox(), logger, 'run1', { hooks });

    expect(hooks.onStepStart).toHaveBeenCalledTimes(3);
    expect(hooks.onStepStart).toHaveBeenCalledWith(
      expect.objectContaining({ step_id: 'step1' }),
      0,
    );
    expect(hooks.onStepStart).toHaveBeenCalledWith(
      expect.objectContaining({ step_id: 'step2' }),
      1,
    );
  });

  it('calls onStepComplete for each completed step', async () => {
    const hooks: ExecutionHooks = {
      onStepComplete: vi.fn(),
    };

    await executePlan(makePlan(2), makeSandbox(), logger, 'run2', { hooks });

    expect(hooks.onStepComplete).toHaveBeenCalledTimes(2);
    expect(hooks.onStepComplete).toHaveBeenCalledWith(
      expect.objectContaining({ step_id: 'step1' }),
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('calls onStepFailed when a step fails', async () => {
    const sandbox = makeSandbox();
    (sandbox.writeFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));

    const hooks: ExecutionHooks = {
      onStepFailed: vi.fn(),
    };

    await executePlan(makePlan(2), sandbox, logger, 'run3', { hooks });

    expect(hooks.onStepFailed).toHaveBeenCalledTimes(1);
    expect(hooks.onStepFailed).toHaveBeenCalledWith(
      expect.objectContaining({ step_id: 'step1' }),
      expect.stringContaining('disk full'),
    );
  });

  it('hooks work in parallel mode', async () => {
    const hooks: ExecutionHooks = {
      onStepStart: vi.fn(),
      onStepComplete: vi.fn(),
    };

    const plan: ExecutionPlan = {
      plan_id: 'parallel-hook',
      execution_mode: 'parallel',
      steps: [
        {
          step_id: 'p1',
          type: 'create_file',
          description: 'File 1',
          path: 'a.txt',
          content: 'a',
          determinism: 'guaranteed',
        },
        {
          step_id: 'p2',
          type: 'create_file',
          description: 'File 2',
          path: 'b.txt',
          content: 'b',
          determinism: 'guaranteed',
        },
      ],
    };

    await executePlan(plan, makeSandbox(), logger, 'run4', { hooks });

    expect(hooks.onStepStart).toHaveBeenCalledTimes(2);
    expect(hooks.onStepComplete).toHaveBeenCalledTimes(2);
  });
});

describe('execution progress', () => {
  let logger: EventLogger;

  beforeEach(() => {
    logger = new EventLogger('progress-run');
  });

  it('emits progress events for sequential execution', async () => {
    const events: ProgressEvent[] = [];

    await executePlan(makePlan(2), makeSandbox(), logger, 'run1', {
      onProgress: (e) => events.push(e),
    });

    // 2 steps × (step_start + step_complete) = 4 events
    expect(events.length).toBe(4);
    expect(events[0].type).toBe('step_start');
    expect(events[0].stepId).toBe('step1');
    expect(events[0].totalSteps).toBe(2);
    expect(events[0].completedSteps).toBe(0);

    expect(events[1].type).toBe('step_complete');
    expect(events[1].completedSteps).toBe(1);

    expect(events[2].type).toBe('step_start');
    expect(events[2].stepId).toBe('step2');

    expect(events[3].type).toBe('step_complete');
    expect(events[3].completedSteps).toBe(2);
  });

  it('emits step_failed and step_skipped events', async () => {
    const sandbox = makeSandbox();
    (sandbox.writeFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'));

    const events: ProgressEvent[] = [];
    await executePlan(makePlan(2), sandbox, logger, 'run2', {
      onProgress: (e) => events.push(e),
    });

    const types = events.map((e) => e.type);
    expect(types).toContain('step_start');
    expect(types).toContain('step_failed');
    expect(types).toContain('step_skipped');
  });

  it('progress events include duration on completion', async () => {
    const events: ProgressEvent[] = [];
    await executePlan(makePlan(1), makeSandbox(), logger, 'run3', {
      onProgress: (e) => events.push(e),
    });

    const completeEvent = events.find((e) => e.type === 'step_complete');
    expect(completeEvent).toBeDefined();
    expect(completeEvent!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('progress events work in parallel mode', async () => {
    const events: ProgressEvent[] = [];
    const plan: ExecutionPlan = {
      plan_id: 'par',
      execution_mode: 'parallel',
      steps: [
        {
          step_id: 'a',
          type: 'create_file',
          description: 'A',
          path: 'a.txt',
          content: 'a',
          determinism: 'guaranteed',
        },
        {
          step_id: 'b',
          type: 'create_file',
          description: 'B',
          path: 'b.txt',
          content: 'b',
          determinism: 'guaranteed',
        },
      ],
    };

    await executePlan(plan, makeSandbox(), logger, 'run4', {
      onProgress: (e) => events.push(e),
    });

    expect(events.filter((e) => e.type === 'step_start').length).toBe(2);
    expect(events.filter((e) => e.type === 'step_complete').length).toBe(2);
  });
});
