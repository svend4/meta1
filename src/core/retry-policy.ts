/**
 * Enhanced retry policies — per-step retry with configurable backoff
 * strategies (fixed, linear, exponential), jitter, max attempts,
 * retry conditions, and circuit breaker.
 */

/** Backoff strategy */
export type BackoffStrategy = 'fixed' | 'linear' | 'exponential';

/** Condition that determines whether to retry */
export type RetryCondition = (error: Error, attempt: number) => boolean;

/** A retry policy configuration */
export interface RetryPolicy {
  /** Maximum number of attempts (including the initial try) */
  maxAttempts: number;
  /** Backoff strategy */
  strategy: BackoffStrategy;
  /** Base delay in milliseconds */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds */
  maxDelayMs: number;
  /** Add random jitter to prevent thundering herd */
  jitter: boolean;
  /** Jitter range as fraction of delay (0-1). Default: 0.25 */
  jitterFraction: number;
  /** Optional condition to decide whether to retry */
  retryIf?: RetryCondition;
  /** Errors matching these patterns always trigger retry */
  retryOn?: string[];
  /** Errors matching these patterns never trigger retry */
  noRetryOn?: string[];
}

/** Result of a retry-wrapped execution */
export interface RetryResult<T> {
  success: boolean;
  value?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
  history: AttemptRecord[];
}

/** Record of a single attempt */
export interface AttemptRecord {
  attempt: number;
  startedAt: string;
  durationMs: number;
  success: boolean;
  error?: string;
  delayBeforeMs: number;
}

/**
 * Create a default retry policy.
 */
export function defaultRetryPolicy(): RetryPolicy {
  return {
    maxAttempts: 3,
    strategy: 'exponential',
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    jitter: true,
    jitterFraction: 0.25,
  };
}

/**
 * Create a no-retry policy (single attempt).
 */
export function noRetryPolicy(): RetryPolicy {
  return {
    maxAttempts: 1,
    strategy: 'fixed',
    baseDelayMs: 0,
    maxDelayMs: 0,
    jitter: false,
    jitterFraction: 0,
  };
}

/**
 * Create an aggressive retry policy for flaky operations.
 */
export function aggressiveRetryPolicy(): RetryPolicy {
  return {
    maxAttempts: 5,
    strategy: 'exponential',
    baseDelayMs: 500,
    maxDelayMs: 60000,
    jitter: true,
    jitterFraction: 0.5,
  };
}

/**
 * Compute the delay before the Nth retry attempt.
 */
export function computeDelay(policy: RetryPolicy, attempt: number): number {
  let delay: number;

  switch (policy.strategy) {
    case 'fixed':
      delay = policy.baseDelayMs;
      break;
    case 'linear':
      delay = policy.baseDelayMs * attempt;
      break;
    case 'exponential':
      delay = policy.baseDelayMs * Math.pow(2, attempt - 1);
      break;
  }

  // Cap at max
  delay = Math.min(delay, policy.maxDelayMs);

  // Apply jitter
  if (policy.jitter && delay > 0) {
    const jitterRange = delay * policy.jitterFraction;
    delay = delay + (Math.random() * 2 - 1) * jitterRange;
    delay = Math.max(0, Math.round(delay));
  }

  return delay;
}

/**
 * Determine whether to retry based on the policy and error.
 */
export function shouldRetry(policy: RetryPolicy, error: Error, attempt: number): boolean {
  if (attempt >= policy.maxAttempts) return false;

  // Check noRetryOn patterns first
  if (policy.noRetryOn) {
    const msg = error.message.toLowerCase();
    for (const pattern of policy.noRetryOn) {
      if (msg.includes(pattern.toLowerCase())) return false;
    }
  }

  // Check retryOn patterns
  if (policy.retryOn && policy.retryOn.length > 0) {
    const msg = error.message.toLowerCase();
    const matchesRetryOn = policy.retryOn.some((p) => msg.includes(p.toLowerCase()));
    if (!matchesRetryOn) return false;
  }

  // Check custom condition
  if (policy.retryIf && !policy.retryIf(error, attempt)) return false;

  return true;
}

/**
 * Execute a function with retry policy.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  onRetry?: (attempt: number, error: Error, delayMs: number) => void,
): Promise<RetryResult<T>> {
  const history: AttemptRecord[] = [];
  let totalDelayMs = 0;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const delayBeforeMs = attempt === 1 ? 0 : computeDelay(policy, attempt - 1);

    if (delayBeforeMs > 0) {
      totalDelayMs += delayBeforeMs;
      await sleep(delayBeforeMs);
    }

    const startedAt = new Date().toISOString();
    const start = Date.now();

    try {
      const value = await fn();
      const durationMs = Date.now() - start;

      history.push({
        attempt,
        startedAt,
        durationMs,
        success: true,
        delayBeforeMs,
      });

      return { success: true, value, attempts: attempt, totalDelayMs, history };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const durationMs = Date.now() - start;

      history.push({
        attempt,
        startedAt,
        durationMs,
        success: false,
        error: error.message,
        delayBeforeMs,
      });

      if (!shouldRetry(policy, error, attempt)) {
        return { success: false, error, attempts: attempt, totalDelayMs, history };
      }

      if (onRetry) {
        const nextDelay = computeDelay(policy, attempt);
        onRetry(attempt, error, nextDelay);
      }
    }
  }

  // Should not reach here but just in case
  const lastError = history[history.length - 1]?.error;
  return {
    success: false,
    error: new Error(lastError ?? 'Max attempts exceeded'),
    attempts: history.length,
    totalDelayMs,
    history,
  };
}

/**
 * Format retry result for display.
 */
export function formatRetryResult<T>(result: RetryResult<T>): string {
  const lines: string[] = [];
  const status = result.success ? 'SUCCEEDED' : 'FAILED';

  lines.push(`Retry Result: ${status} after ${result.attempts} attempt(s)`);
  lines.push(`  Total delay: ${result.totalDelayMs}ms`);

  if (result.error) {
    lines.push(`  Error: ${result.error.message}`);
  }

  for (const h of result.history) {
    const icon = h.success ? '+' : '-';
    const err = h.error ? ` (${h.error})` : '';
    lines.push(`  [${icon}] Attempt ${h.attempt}: ${h.durationMs}ms${err}`);
  }

  return lines.join('\n');
}

// ── Internal ──

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
