/**
 * Token-bucket rate limiter for controlling concurrent API calls and step execution.
 * Useful for preventing overload on external services during parallel plan execution.
 */

/** Rate limiter configuration */
export interface RateLimiterConfig {
  /** Maximum number of concurrent operations. */
  maxConcurrent: number;
  /** Minimum delay between operation starts in milliseconds. Default: 0. */
  minIntervalMs?: number;
  /** Maximum queue size. New requests are rejected when exceeded. Default: Infinity. */
  maxQueueSize?: number;
}

/** Stats about the rate limiter's current state */
export interface RateLimiterStats {
  active: number;
  queued: number;
  completed: number;
  rejected: number;
  maxConcurrent: number;
}

interface QueuedOperation<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/**
 * Token-bucket rate limiter that controls concurrency and pacing.
 * Wrap async operations with `limiter.execute(fn)` to throttle them.
 */
export class RateLimiter {
  private readonly maxConcurrent: number;
  private readonly minIntervalMs: number;
  private readonly maxQueueSize: number;
  private active = 0;
  private completed = 0;
  private rejected = 0;
  private queue: QueuedOperation<unknown>[] = [];
  private lastStartTime = 0;

  constructor(config: RateLimiterConfig) {
    if (config.maxConcurrent < 1) {
      throw new Error('maxConcurrent must be >= 1');
    }
    this.maxConcurrent = config.maxConcurrent;
    this.minIntervalMs = config.minIntervalMs ?? 0;
    this.maxQueueSize = config.maxQueueSize ?? Infinity;
  }

  /**
   * Execute an async function, respecting concurrency and pacing limits.
   * Queues the operation if at capacity.
   * Rejects if queue is full.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active < this.maxConcurrent) {
      return this.run(fn);
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.rejected++;
      throw new RateLimitExceededError(this.maxConcurrent, this.queue.length);
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn: fn as () => Promise<unknown>, resolve: resolve as (value: unknown) => void, reject });
    });
  }

  /** Get current limiter stats */
  getStats(): RateLimiterStats {
    return {
      active: this.active,
      queued: this.queue.length,
      completed: this.completed,
      rejected: this.rejected,
      maxConcurrent: this.maxConcurrent,
    };
  }

  /** Check if the limiter has pending or active work */
  isBusy(): boolean {
    return this.active > 0 || this.queue.length > 0;
  }

  /** Wait until all active and queued operations complete */
  async drain(): Promise<void> {
    while (this.isBusy()) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    this.active++;

    // Enforce minimum interval
    if (this.minIntervalMs > 0) {
      const elapsed = Date.now() - this.lastStartTime;
      if (elapsed < this.minIntervalMs) {
        await sleep(this.minIntervalMs - elapsed);
      }
    }
    this.lastStartTime = Date.now();

    try {
      const result = await fn();
      return result;
    } finally {
      this.active--;
      this.completed++;
      this.dequeue();
    }
  }

  private dequeue(): void {
    if (this.queue.length === 0) return;
    if (this.active >= this.maxConcurrent) return;

    const next = this.queue.shift()!;
    this.run(next.fn).then(next.resolve, next.reject);
  }
}

/** Error thrown when the rate limiter queue is full */
export class RateLimitExceededError extends Error {
  readonly maxConcurrent: number;
  readonly queueSize: number;

  constructor(maxConcurrent: number, queueSize: number) {
    super(`Rate limit exceeded: ${maxConcurrent} concurrent operations, ${queueSize} queued`);
    this.name = 'RateLimitExceededError';
    this.maxConcurrent = maxConcurrent;
    this.queueSize = queueSize;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
