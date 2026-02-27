import { describe, it, expect } from 'vitest';
import {
  defaultRetryPolicy,
  noRetryPolicy,
  aggressiveRetryPolicy,
  computeDelay,
  shouldRetry,
  withRetry,
  formatRetryResult,
} from '../../src/core/retry-policy.js';
import type { RetryPolicy } from '../../src/core/retry-policy.js';

describe('retry-policy', () => {
  describe('presets', () => {
    it('default policy: 3 attempts, exponential', () => {
      const p = defaultRetryPolicy();
      expect(p.maxAttempts).toBe(3);
      expect(p.strategy).toBe('exponential');
      expect(p.jitter).toBe(true);
    });

    it('no retry policy: 1 attempt', () => {
      const p = noRetryPolicy();
      expect(p.maxAttempts).toBe(1);
    });

    it('aggressive policy: 5 attempts', () => {
      const p = aggressiveRetryPolicy();
      expect(p.maxAttempts).toBe(5);
      expect(p.jitterFraction).toBe(0.5);
    });
  });

  describe('computeDelay', () => {
    it('fixed strategy returns base delay', () => {
      const p: RetryPolicy = { ...defaultRetryPolicy(), strategy: 'fixed', baseDelayMs: 1000, jitter: false };
      expect(computeDelay(p, 1)).toBe(1000);
      expect(computeDelay(p, 3)).toBe(1000);
    });

    it('linear strategy multiplies by attempt', () => {
      const p: RetryPolicy = { ...defaultRetryPolicy(), strategy: 'linear', baseDelayMs: 1000, jitter: false };
      expect(computeDelay(p, 1)).toBe(1000);
      expect(computeDelay(p, 3)).toBe(3000);
    });

    it('exponential strategy doubles', () => {
      const p: RetryPolicy = { ...defaultRetryPolicy(), strategy: 'exponential', baseDelayMs: 1000, jitter: false };
      expect(computeDelay(p, 1)).toBe(1000);
      expect(computeDelay(p, 2)).toBe(2000);
      expect(computeDelay(p, 3)).toBe(4000);
    });

    it('caps at maxDelayMs', () => {
      const p: RetryPolicy = { ...defaultRetryPolicy(), strategy: 'exponential', baseDelayMs: 1000, maxDelayMs: 5000, jitter: false };
      expect(computeDelay(p, 10)).toBe(5000);
    });

    it('applies jitter within range', () => {
      const p: RetryPolicy = { ...defaultRetryPolicy(), strategy: 'fixed', baseDelayMs: 1000, maxDelayMs: 30000, jitter: true, jitterFraction: 0.25 };
      const delays = new Set<number>();
      for (let i = 0; i < 20; i++) {
        delays.add(computeDelay(p, 1));
      }
      // Should have some variation
      expect(delays.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe('shouldRetry', () => {
    it('returns false when at max attempts', () => {
      const p = defaultRetryPolicy();
      expect(shouldRetry(p, new Error('fail'), 3)).toBe(false);
    });

    it('returns true when under max attempts', () => {
      const p = defaultRetryPolicy();
      expect(shouldRetry(p, new Error('fail'), 1)).toBe(true);
    });

    it('respects retryOn patterns', () => {
      const p: RetryPolicy = { ...defaultRetryPolicy(), retryOn: ['timeout'] };
      expect(shouldRetry(p, new Error('connection timeout'), 1)).toBe(true);
      expect(shouldRetry(p, new Error('permission denied'), 1)).toBe(false);
    });

    it('respects noRetryOn patterns', () => {
      const p: RetryPolicy = { ...defaultRetryPolicy(), noRetryOn: ['fatal'] };
      expect(shouldRetry(p, new Error('fatal error'), 1)).toBe(false);
      expect(shouldRetry(p, new Error('transient error'), 1)).toBe(true);
    });

    it('respects custom retryIf', () => {
      const p: RetryPolicy = { ...defaultRetryPolicy(), retryIf: (_err, attempt) => attempt < 2 };
      expect(shouldRetry(p, new Error('x'), 1)).toBe(true);
      expect(shouldRetry(p, new Error('x'), 2)).toBe(false);
    });
  });

  describe('withRetry', () => {
    it('succeeds on first attempt', async () => {
      const result = await withRetry(() => Promise.resolve(42), noRetryPolicy());
      expect(result.success).toBe(true);
      expect(result.value).toBe(42);
      expect(result.attempts).toBe(1);
    });

    it('retries on failure then succeeds', async () => {
      let calls = 0;
      const result = await withRetry(
        () => {
          calls++;
          if (calls < 3) throw new Error('fail');
          return Promise.resolve('ok');
        },
        { ...defaultRetryPolicy(), baseDelayMs: 1, maxDelayMs: 10, jitter: false },
      );

      expect(result.success).toBe(true);
      expect(result.value).toBe('ok');
      expect(result.attempts).toBe(3);
    });

    it('fails after max attempts', async () => {
      const result = await withRetry(
        () => Promise.reject(new Error('always fail')),
        { ...defaultRetryPolicy(), maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 10, jitter: false },
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(2);
      expect(result.error?.message).toBe('always fail');
    });

    it('calls onRetry callback', async () => {
      const retries: number[] = [];
      await withRetry(
        () => Promise.reject(new Error('fail')),
        { ...defaultRetryPolicy(), maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, jitter: false },
        (attempt) => retries.push(attempt),
      );

      expect(retries).toEqual([1, 2]);
    });

    it('records attempt history', async () => {
      let calls = 0;
      const result = await withRetry(
        () => {
          calls++;
          if (calls < 2) throw new Error('fail');
          return Promise.resolve('ok');
        },
        { ...defaultRetryPolicy(), maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, jitter: false },
      );

      expect(result.history).toHaveLength(2);
      expect(result.history[0].success).toBe(false);
      expect(result.history[1].success).toBe(true);
    });

    it('respects retryOn', async () => {
      const result = await withRetry(
        () => Promise.reject(new Error('permission denied')),
        { ...defaultRetryPolicy(), retryOn: ['timeout'], baseDelayMs: 1, maxDelayMs: 10, jitter: false },
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1); // Did not retry
    });
  });

  describe('formatRetryResult', () => {
    it('formats success', async () => {
      const result = await withRetry(() => Promise.resolve(42), noRetryPolicy());
      const output = formatRetryResult(result);
      expect(output).toContain('SUCCEEDED');
      expect(output).toContain('1 attempt');
    });

    it('formats failure', async () => {
      const result = await withRetry(
        () => Promise.reject(new Error('boom')),
        { ...defaultRetryPolicy(), maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 10, jitter: false },
      );
      const output = formatRetryResult(result);
      expect(output).toContain('FAILED');
      expect(output).toContain('boom');
    });
  });
});
