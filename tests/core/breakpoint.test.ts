import { describe, it, expect, vi } from 'vitest';
import {
  BreakpointManager,
  createLoggingHandler,
  createSkipHandler,
  createAbortHandler,
  formatBreakpointState,
} from '../../src/core/breakpoint.js';
import type { BreakpointState } from '../../src/core/breakpoint.js';
import type { Step } from '../../src/types/execution-plan.js';

function makeState(overrides?: Partial<BreakpointState>): BreakpointState {
  return {
    step: {
      step_id: 's1',
      type: 'run_command',
      description: 'Run tests',
      command: 'npm',
      args: ['test'],
      determinism: 'best_effort',
    } as Step,
    stepIndex: 0,
    totalSteps: 3,
    completedResults: [],
    skippedStepIds: [],
    elapsedMs: 500,
    ...overrides,
  };
}

describe('BreakpointManager', () => {
  it('returns continue when no breakpoints', async () => {
    const mgr = new BreakpointManager();
    const action = await mgr.evaluate(makeState());
    expect(action).toBe('continue');
  });

  it('breaks on matching step ID', async () => {
    const handler = vi.fn().mockReturnValue('continue');
    const mgr = new BreakpointManager([
      { stepIds: ['s1'], handler },
    ]);

    const action = await mgr.evaluate(makeState());
    expect(handler).toHaveBeenCalled();
    expect(action).toBe('continue');
  });

  it('does not break on non-matching step ID', async () => {
    const handler = vi.fn().mockReturnValue('continue');
    const mgr = new BreakpointManager([
      { stepIds: ['s999'], handler },
    ]);

    const action = await mgr.evaluate(makeState());
    expect(handler).not.toHaveBeenCalled();
    expect(action).toBe('continue');
  });

  it('breaks on step type', async () => {
    const handler = vi.fn().mockReturnValue('skip');
    const mgr = new BreakpointManager([
      { stepType: 'run_command', handler },
    ]);

    const action = await mgr.evaluate(makeState());
    expect(action).toBe('skip');
  });

  it('breaks on determinism', async () => {
    const handler = vi.fn().mockReturnValue('abort');
    const mgr = new BreakpointManager([
      { determinism: 'best_effort', handler },
    ]);

    const action = await mgr.evaluate(makeState());
    expect(action).toBe('abort');
  });

  it('breaks at specific index', async () => {
    const handler = vi.fn().mockReturnValue('continue');
    const mgr = new BreakpointManager([
      { atIndex: 0, handler },
    ]);

    expect(await mgr.evaluate(makeState({ stepIndex: 0 }))).toBe('continue');
    expect(handler).toHaveBeenCalledTimes(1);

    expect(await mgr.evaluate(makeState({ stepIndex: 1 }))).toBe('continue');
    expect(handler).toHaveBeenCalledTimes(1); // Not called again
  });

  it('breaks before known failure', async () => {
    const handler = vi.fn().mockReturnValue('skip');
    const mgr = new BreakpointManager([
      { beforeFailure: true, handler },
    ]);

    mgr.setFailedSteps(['s1']);
    const action = await mgr.evaluate(makeState());
    expect(action).toBe('skip');
  });

  it('supports async handlers', async () => {
    const handler = vi.fn().mockResolvedValue('abort');
    const mgr = new BreakpointManager([
      { stepIds: ['s1'], handler },
    ]);

    const action = await mgr.evaluate(makeState());
    expect(action).toBe('abort');
  });

  it('adds breakpoints dynamically', async () => {
    const mgr = new BreakpointManager();
    const handler = vi.fn().mockReturnValue('continue');
    mgr.addBreakpoint({ stepIds: ['s1'], handler });

    await mgr.evaluate(makeState());
    expect(handler).toHaveBeenCalled();
  });

  it('removes breakpoints', () => {
    const handler = vi.fn().mockReturnValue('continue');
    const mgr = new BreakpointManager([
      { stepIds: ['s1'], handler },
    ]);

    expect(mgr.removeBreakpoint('s1')).toBe(true);
    expect(mgr.getBreakpoints()).toHaveLength(0);
  });

  it('clears all breakpoints', () => {
    const handler = vi.fn().mockReturnValue('continue');
    const mgr = new BreakpointManager([
      { stepIds: ['s1'], handler },
      { stepType: 'run_command', handler },
    ]);

    mgr.clearBreakpoints();
    expect(mgr.getBreakpoints()).toHaveLength(0);
  });
});

describe('handler factories', () => {
  it('createLoggingHandler continues and calls callback', () => {
    const cb = vi.fn();
    const handler = createLoggingHandler(cb);
    const action = handler(makeState());
    expect(action).toBe('continue');
    expect(cb).toHaveBeenCalled();
  });

  it('createSkipHandler skips', () => {
    expect(createSkipHandler()(makeState())).toBe('skip');
  });

  it('createAbortHandler aborts', () => {
    expect(createAbortHandler()(makeState())).toBe('abort');
  });
});

describe('formatBreakpointState', () => {
  it('formats state for display', () => {
    const output = formatBreakpointState(makeState());
    expect(output).toContain('Breakpoint: step 1/3');
    expect(output).toContain('s1');
    expect(output).toContain('run_command');
    expect(output).toContain('Run tests');
  });

  it('shows dependencies', () => {
    const output = formatBreakpointState(makeState({
      step: {
        step_id: 's2',
        type: 'run_command',
        description: 'Build',
        command: 'npm',
        args: ['build'],
        determinism: 'best_effort',
        depends_on: ['s1'],
      } as Step,
    }));
    expect(output).toContain('Depends on: s1');
  });
});
