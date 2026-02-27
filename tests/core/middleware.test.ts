import { describe, it, expect, vi } from 'vitest';
import {
  MiddlewarePipeline,
  createLoggingMiddleware,
  createEnvMiddleware,
  createTimingMiddleware,
  createSkipMiddleware,
  createMiddlewareContext,
} from '../../src/core/middleware.js';
import type { StepMiddleware, MiddlewareContext } from '../../src/core/middleware.js';
import type { Step } from '../../src/types/execution-plan.js';

const testStep: Step = {
  step_id: 's1',
  type: 'run_command',
  description: 'Test',
  command: 'echo',
  args: ['hi'],
  determinism: 'best_effort',
};

function makeCtx(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return createMiddlewareContext(testStep, 0, {}, 0, ...[] as []);
}

describe('MiddlewarePipeline', () => {
  it('runs before hooks in priority order', async () => {
    const order: string[] = [];
    const pipeline = new MiddlewarePipeline();

    pipeline.use({ name: 'b', priority: 20, before: () => { order.push('b'); } });
    pipeline.use({ name: 'a', priority: 10, before: () => { order.push('a'); } });

    await pipeline.runBefore(makeCtx());
    expect(order).toEqual(['a', 'b']);
  });

  it('runs after hooks in reverse priority order', async () => {
    const order: string[] = [];
    const pipeline = new MiddlewarePipeline();

    pipeline.use({ name: 'a', priority: 10, after: () => { order.push('a'); } });
    pipeline.use({ name: 'b', priority: 20, after: () => { order.push('b'); } });

    await pipeline.runAfter(makeCtx());
    expect(order).toEqual(['b', 'a']);
  });

  it('stops before hooks when skip is set', async () => {
    const order: string[] = [];
    const pipeline = new MiddlewarePipeline();

    pipeline.use({ name: 'a', priority: 10, before: (ctx) => { ctx.skip = true; order.push('a'); } });
    pipeline.use({ name: 'b', priority: 20, before: () => { order.push('b'); } });

    const ctx = makeCtx();
    await pipeline.runBefore(ctx);
    expect(order).toEqual(['a']);
    expect(ctx.skip).toBe(true);
  });

  it('runs error hooks in reverse order', async () => {
    const order: string[] = [];
    const pipeline = new MiddlewarePipeline();

    pipeline.use({ name: 'a', priority: 10, onError: () => { order.push('a'); } });
    pipeline.use({ name: 'b', priority: 20, onError: () => { order.push('b'); } });

    await pipeline.runError(makeCtx());
    expect(order).toEqual(['b', 'a']);
  });

  it('removes middleware by name', () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use({ name: 'a', handler: vi.fn() } as unknown as StepMiddleware);
    expect(pipeline.remove('a')).toBe(true);
    expect(pipeline.list()).toHaveLength(0);
  });

  it('clears all middleware', () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use({ name: 'a', before: vi.fn() });
    pipeline.use({ name: 'b', before: vi.fn() });
    pipeline.clear();
    expect(pipeline.list()).toHaveLength(0);
  });

  it('lists middleware names', () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use({ name: 'logger', before: vi.fn() });
    pipeline.use({ name: 'timing', before: vi.fn() });
    expect(pipeline.list()).toEqual(['logger', 'timing']);
  });

  it('supports async hooks', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use({
      name: 'async',
      before: async (ctx) => {
        await new Promise((r) => setTimeout(r, 1));
        ctx.metadata['ran'] = true;
      },
    });

    const ctx = makeCtx();
    await pipeline.runBefore(ctx);
    expect(ctx.metadata['ran']).toBe(true);
  });
});

describe('built-in middleware', () => {
  it('logging middleware calls log function', async () => {
    const logs: string[] = [];
    const mw = createLoggingMiddleware((msg) => logs.push(msg));
    const ctx = makeCtx();

    await mw.before!(ctx);
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain('before');

    await mw.after!(ctx);
    expect(logs.length).toBe(2);
    expect(logs[1]).toContain('after');
  });

  it('env middleware injects env vars', async () => {
    const mw = createEnvMiddleware({ FOO: 'bar', BAZ: 'qux' });
    const ctx = makeCtx();

    await mw.before!(ctx);
    expect(ctx.env.FOO).toBe('bar');
    expect(ctx.env.BAZ).toBe('qux');
  });

  it('timing middleware records duration', async () => {
    const mw = createTimingMiddleware();
    const ctx = makeCtx();

    await mw.before!(ctx);
    await new Promise((r) => setTimeout(r, 5));
    await mw.after!(ctx);

    expect(ctx.metadata['timing:duration_ms']).toBeGreaterThanOrEqual(0);
  });

  it('skip middleware skips matching steps', async () => {
    const mw = createSkipMiddleware((s) => s.type === 'run_command');
    const ctx = makeCtx();

    await mw.before!(ctx);
    expect(ctx.skip).toBe(true);
  });

  it('skip middleware does not skip non-matching steps', async () => {
    const mw = createSkipMiddleware((s) => s.type === 'create_file');
    const ctx = makeCtx();

    await mw.before!(ctx);
    expect(ctx.skip).toBe(false);
  });
});

describe('createMiddlewareContext', () => {
  it('creates context with copied step and env', () => {
    const ctx = createMiddlewareContext(testStep, 3, { A: 'B' }, 1000);
    expect(ctx.step.step_id).toBe('s1');
    expect(ctx.stepIndex).toBe(3);
    expect(ctx.env.A).toBe('B');
    expect(ctx.elapsedMs).toBe(1000);
    expect(ctx.skip).toBe(false);
    expect(ctx.metadata).toEqual({});
  });
});
