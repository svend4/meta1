import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateCondition } from '../../src/core/condition.js';
import type { ConditionContext } from '../../src/core/condition.js';
import { executePlan } from '../../src/core/executor.js';
import { EventLogger } from '../../src/core/logger.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';
import type { Sandbox } from '../../src/sandbox/types.js';
import type { StepResult } from '../../src/types/run-summary.js';

function makeContext(overrides?: Partial<ConditionContext>): ConditionContext {
  return {
    env: { NODE_ENV: 'test', CI: 'true' },
    workspacePath: '/tmp/test',
    stepResults: new Map(),
    ...overrides,
  };
}

describe('evaluateCondition', () => {
  it('env_var: true when variable is set', () => {
    const ctx = makeContext();
    expect(evaluateCondition({ type: 'env_var', target: 'CI' }, ctx)).toBe(true);
  });

  it('env_var: false when variable is unset', () => {
    const ctx = makeContext();
    expect(evaluateCondition({ type: 'env_var', target: 'MISSING_VAR' }, ctx)).toBe(false);
  });

  it('env_var: matches exact value with equals', () => {
    const ctx = makeContext();
    expect(evaluateCondition({ type: 'env_var', target: 'NODE_ENV', equals: 'test' }, ctx)).toBe(true);
    expect(evaluateCondition({ type: 'env_var', target: 'NODE_ENV', equals: 'prod' }, ctx)).toBe(false);
  });

  it('negate inverts result', () => {
    const ctx = makeContext();
    expect(evaluateCondition({ type: 'env_var', target: 'CI', negate: true }, ctx)).toBe(false);
    expect(evaluateCondition({ type: 'env_var', target: 'MISSING', negate: true }, ctx)).toBe(true);
  });

  it('step_status: true when step completed', () => {
    const results = new Map<string, StepResult>();
    results.set('s1', { step_id: 's1', type: 'run_command', status: 'completed' });
    const ctx = makeContext({ stepResults: results });

    expect(evaluateCondition({ type: 'step_status', target: 's1' }, ctx)).toBe(true);
  });

  it('step_status: false when step failed', () => {
    const results = new Map<string, StepResult>();
    results.set('s1', { step_id: 's1', type: 'run_command', status: 'failed' });
    const ctx = makeContext({ stepResults: results });

    expect(evaluateCondition({ type: 'step_status', target: 's1' }, ctx)).toBe(false);
  });

  it('step_status: matches explicit equals', () => {
    const results = new Map<string, StepResult>();
    results.set('s1', { step_id: 's1', type: 'run_command', status: 'failed' });
    const ctx = makeContext({ stepResults: results });

    expect(evaluateCondition({ type: 'step_status', target: 's1', equals: 'failed' }, ctx)).toBe(true);
  });

  it('step_status: false for unknown step', () => {
    const ctx = makeContext();
    expect(evaluateCondition({ type: 'step_status', target: 'unknown' }, ctx)).toBe(false);
  });
});

describe('conditional step execution', () => {
  let logger: EventLogger;

  beforeEach(() => {
    logger = new EventLogger('condition-run');
  });

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

  it('skips step when condition is not met', async () => {
    const sandbox = makeSandbox();
    const plan: ExecutionPlan = {
      plan_id: 'cond1',
      steps: [
        {
          step_id: 'cmd1',
          type: 'run_command',
          description: 'Only in prod',
          command: 'deploy',
          args: [],
          determinism: 'best_effort',
          condition: { type: 'env_var', target: 'CONTINUUM_DEPLOY', equals: 'true' },
        },
      ],
    };

    const result = await executePlan(plan, sandbox, logger, 'run1');
    expect(result.steps[0].status).toBe('skipped');
    expect(sandbox.exec).not.toHaveBeenCalled();
  });

  it('runs step when condition is met', async () => {
    const sandbox = makeSandbox();
    // Set the env var the condition checks
    const origVal = process.env.CONTINUUM_TEST_COND;
    process.env.CONTINUUM_TEST_COND = 'yes';

    try {
      const plan: ExecutionPlan = {
        plan_id: 'cond2',
        steps: [
          {
            step_id: 'cmd2',
            type: 'run_command',
            description: 'Conditional run',
            command: 'echo',
            args: ['hi'],
            determinism: 'best_effort',
            condition: { type: 'env_var', target: 'CONTINUUM_TEST_COND' },
          },
        ],
      };

      const result = await executePlan(plan, sandbox, logger, 'run2');
      expect(result.steps[0].status).toBe('completed');
      expect(sandbox.exec).toHaveBeenCalledTimes(1);
    } finally {
      if (origVal === undefined) delete process.env.CONTINUUM_TEST_COND;
      else process.env.CONTINUUM_TEST_COND = origVal;
    }
  });

  it('runs step when no condition is set', async () => {
    const sandbox = makeSandbox();
    const plan: ExecutionPlan = {
      plan_id: 'cond3',
      steps: [
        {
          step_id: 'cmd3',
          type: 'run_command',
          description: 'No condition',
          command: 'echo',
          args: ['always'],
          determinism: 'best_effort',
        },
      ],
    };

    const result = await executePlan(plan, sandbox, logger, 'run3');
    expect(result.steps[0].status).toBe('completed');
  });

  it('negate skips when condition would be true', async () => {
    const sandbox = makeSandbox();
    const origVal = process.env.CI;
    process.env.CI = 'true';

    try {
      const plan: ExecutionPlan = {
        plan_id: 'cond4',
        steps: [
          {
            step_id: 'cmd4',
            type: 'run_command',
            description: 'Skip in CI',
            command: 'test',
            args: [],
            determinism: 'best_effort',
            condition: { type: 'env_var', target: 'CI', negate: true },
          },
        ],
      };

      const result = await executePlan(plan, sandbox, logger, 'run4');
      expect(result.steps[0].status).toBe('skipped');
    } finally {
      if (origVal === undefined) delete process.env.CI;
      else process.env.CI = origVal;
    }
  });
});
