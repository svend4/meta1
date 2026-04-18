import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginRegistry } from '../../src/core/plugin.js';
import type { ContinuumPlugin, BeforeStepContext } from '../../src/core/plugin.js';
import type { RunSummary, StepResult } from '../../src/types/run-summary.js';
import type { Step } from '../../src/types/execution-plan.js';

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it('registers a plugin', () => {
    registry.register({ name: 'test-plugin' });
    expect(registry.list()).toEqual(['test-plugin']);
    expect(registry.size).toBe(1);
  });

  it('throws on duplicate plugin name', () => {
    registry.register({ name: 'duplicate' });
    expect(() => registry.register({ name: 'duplicate' })).toThrow('already registered');
  });

  it('unregisters a plugin', () => {
    registry.register({ name: 'removable' });
    expect(registry.unregister('removable')).toBe(true);
    expect(registry.list()).toEqual([]);
  });

  it('returns false when unregistering unknown plugin', () => {
    expect(registry.unregister('ghost')).toBe(false);
  });

  it('clears all plugins', () => {
    registry.register({ name: 'a' });
    registry.register({ name: 'b' });
    registry.clear();
    expect(registry.size).toBe(0);
  });

  it('invokes onBeforePlan hooks', async () => {
    const hook = vi.fn();
    registry.register({ name: 'plan-hook', onBeforePlan: hook });

    await registry.beforePlan({ prompt: 'test', taskId: 't1', runId: 'r1' });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith({ prompt: 'test', taskId: 't1', runId: 'r1' });
  });

  it('invokes onAfterPlan hooks', async () => {
    const hook = vi.fn();
    registry.register({ name: 'after-plan', onAfterPlan: hook });

    const plan = { plan_id: 'p1', steps: [] };
    await registry.afterPlan({ plan, source: 'llm', runId: 'r1' });
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('invokes onBeforeStep hooks and supports skip', async () => {
    const skipPlugin: ContinuumPlugin = {
      name: 'skipper',
      onBeforeStep: async (ctx) => {
        if (ctx.step.step_id === 'skip-me') {
          ctx.skip = true;
        }
      },
    };
    registry.register(skipPlugin);

    const step: Step = {
      step_id: 'skip-me',
      type: 'run_command',
      description: 'Skippable',
      command: 'echo',
      args: [],
      determinism: 'best_effort',
    };

    const ctx = await registry.beforeStep({
      step,
      stepIndex: 0,
      runId: 'r1',
      skip: false,
    });

    expect(ctx.skip).toBe(true);
  });

  it('invokes onAfterStep hooks', async () => {
    const hook = vi.fn();
    registry.register({ name: 'after-step', onAfterStep: hook });

    const step: Step = {
      step_id: 's1',
      type: 'run_command',
      description: 'Test',
      command: 'echo',
      args: [],
      determinism: 'best_effort',
    };

    const result: StepResult = {
      step_id: 's1',
      type: 'run_command',
      status: 'completed',
    };

    await registry.afterStep({ step, result, stepIndex: 0, runId: 'r1' });
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('invokes onRunComplete hooks', async () => {
    const hook = vi.fn();
    registry.register({ name: 'run-complete', onRunComplete: hook });

    const summary = { run_id: 'r1', status: 'completed' } as RunSummary;
    await registry.runComplete(summary);
    expect(hook).toHaveBeenCalledWith(summary);
  });

  it('invokes hooks in registration order', async () => {
    const order: string[] = [];

    registry.register({
      name: 'first',
      onBeforePlan: async () => { order.push('first'); },
    });
    registry.register({
      name: 'second',
      onBeforePlan: async () => { order.push('second'); },
    });

    await registry.beforePlan({ prompt: '', taskId: '', runId: '' });
    expect(order).toEqual(['first', 'second']);
  });

  it('skips plugins without the specific hook', async () => {
    registry.register({ name: 'no-hooks' });
    registry.register({ name: 'has-hooks', onRunComplete: vi.fn() });

    // Should not throw
    await registry.beforePlan({ prompt: '', taskId: '', runId: '' });
    await registry.afterPlan({ plan: { plan_id: 'p', steps: [] }, source: 'llm', runId: '' });
  });
});
