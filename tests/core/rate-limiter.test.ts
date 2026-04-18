import { describe, it, expect } from 'vitest';
import { RateLimiter, RateLimitExceededError } from '../../src/core/rate-limiter.js';

describe('RateLimiter', () => {
  it('runs operations up to maxConcurrent', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 3 });
    const active: number[] = [];
    let maxActive = 0;

    const tasks = Array.from({ length: 6 }, (_, i) =>
      limiter.execute(async () => {
        active.push(i);
        maxActive = Math.max(maxActive, active.length);
        await sleep(20);
        active.splice(active.indexOf(i), 1);
        return i;
      }),
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('processes all queued operations', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });
    const order: number[] = [];

    const tasks = Array.from({ length: 5 }, (_, i) =>
      limiter.execute(async () => {
        order.push(i);
        return i;
      }),
    );

    await Promise.all(tasks);
    expect(order).toHaveLength(5);
  });

  it('rejects when queue is full', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1, maxQueueSize: 1 });

    // Fill concurrency slot
    const p1 = limiter.execute(() => sleep(100));
    // Fill queue
    const p2 = limiter.execute(() => sleep(10));

    // Should reject
    await expect(limiter.execute(() => sleep(10))).rejects.toThrow(RateLimitExceededError);

    await p1;
    await p2;
  });

  it('throws when maxConcurrent < 1', () => {
    expect(() => new RateLimiter({ maxConcurrent: 0 })).toThrow('maxConcurrent must be >= 1');
  });

  it('reports correct stats', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 2 });

    await limiter.execute(async () => 'done');
    const stats = limiter.getStats();

    expect(stats.completed).toBe(1);
    expect(stats.active).toBe(0);
    expect(stats.queued).toBe(0);
    expect(stats.maxConcurrent).toBe(2);
  });

  it('isBusy returns correct state', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });

    expect(limiter.isBusy()).toBe(false);

    let resolve!: () => void;
    const blocker = new Promise<void>((r) => { resolve = r; });

    const task = limiter.execute(() => blocker);
    expect(limiter.isBusy()).toBe(true);

    resolve();
    await task;
    expect(limiter.isBusy()).toBe(false);
  });

  it('handles errors without blocking queue', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });

    await expect(
      limiter.execute(async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');

    // Next task should still work
    const result = await limiter.execute(async () => 42);
    expect(result).toBe(42);
  });

  it('drain waits for all operations', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 2 });
    const completed: number[] = [];

    for (let i = 0; i < 4; i++) {
      limiter.execute(async () => {
        await sleep(10);
        completed.push(i);
      });
    }

    await limiter.drain();
    expect(completed).toHaveLength(4);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
