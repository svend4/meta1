import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { retryFlakyAssertions } from '../../src/core/repair-retry.js';
import { LocalSandbox } from '../../src/sandbox/local.js';
import type { Assertion, AssertionResult } from '../../src/types/assertion.js';
import type { DriftVector } from '../../src/types/drift-vector.js';
import type { EventLogger } from '../../src/core/logger.js';

let tempDir: string;
let sandbox: LocalSandbox;

const mockLogger: EventLogger = {
  log: vi.fn(),
  close: vi.fn(),
};

const RUN_ID = 'retry-test-run';

function makeDrift(category: DriftVector['category'], assertionId: string): DriftVector {
  return {
    drift_id: randomUUID(),
    detected_at: new Date().toISOString(),
    run_id: RUN_ID,
    source_run_id: 'src-run',
    category,
    severity: 'degraded',
    repairable: true,
    repair_level: 1,
    details: {
      step_id: '', step_order: -1,
      expected: 'pass', actual: 'fail',
      assertion_id: assertionId,
      assertion_stability: category === 'assertion_flaky' ? 'flaky' : 'environmental',
    },
  };
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-retry-test-'));
  sandbox = new LocalSandbox(join(tempDir, 'ws'));
  await sandbox.init();
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('retryFlakyAssertions', () => {
  it('returns unchanged when no retryable drifts', async () => {
    const assertions: Assertion[] = [];
    const failedResults: AssertionResult[] = [];
    const drifts: DriftVector[] = [makeDrift('assertion_stable', 'a1')]; // stable — not retryable

    const result = await retryFlakyAssertions(
      assertions, failedResults, drifts, sandbox, mockLogger, RUN_ID,
    );

    expect(result.resolved).toHaveLength(0);
    expect(result.remaining).toEqual(drifts);
  });

  it('resolves flaky assertion when it passes on retry', async () => {
    // Create the file so the assertion passes
    await sandbox.writeFile('target.txt', 'data');

    const assertions: Assertion[] = [{
      assertion_id: 'a-flaky',
      type: 'file_exists',
      description: 'file exists',
      spec: { type: 'file_exists', path: 'target.txt' },
      required: true,
      stability: 'flaky',
      retry: { max_attempts: 2, backoff_ms: 50 },
    }];

    const failedResults: AssertionResult[] = [{
      assertion_id: 'a-flaky',
      type: 'file_exists',
      stability: 'flaky',
      passed: false,
      attempts: 1,
      duration_ms: 5,
      expected: 'file exists: target.txt',
      actual: 'not found',
    }];

    const drifts: DriftVector[] = [makeDrift('assertion_flaky', 'a-flaky')];

    const result = await retryFlakyAssertions(
      assertions, failedResults, drifts, sandbox, mockLogger, RUN_ID,
    );

    expect(result.resolved).toHaveLength(1);
    expect(result.remaining).toHaveLength(0);
    expect(result.updatedResults.find((r) => r.assertion_id === 'a-flaky')!.passed).toBe(true);
  });

  it('keeps flaky drift when assertion still fails on retry', async () => {
    const assertions: Assertion[] = [{
      assertion_id: 'a-flaky',
      type: 'file_exists',
      description: 'still missing',
      spec: { type: 'file_exists', path: 'no-file.txt' },
      required: true,
      stability: 'flaky',
      retry: { max_attempts: 1, backoff_ms: 50 },
    }];

    const failedResults: AssertionResult[] = [{
      assertion_id: 'a-flaky',
      type: 'file_exists',
      stability: 'flaky',
      passed: false,
      attempts: 1,
      duration_ms: 5,
      expected: 'exists',
      actual: 'not found',
    }];

    const drifts: DriftVector[] = [makeDrift('assertion_flaky', 'a-flaky')];

    const result = await retryFlakyAssertions(
      assertions, failedResults, drifts, sandbox, mockLogger, RUN_ID,
    );

    expect(result.resolved).toHaveLength(0);
    expect(result.remaining).toHaveLength(1);
  });

  it('resolves environmental assertions when they pass', async () => {
    await sandbox.writeFile('env.txt', 'env data');

    const assertions: Assertion[] = [{
      assertion_id: 'a-env',
      type: 'file_exists',
      description: 'env file',
      spec: { type: 'file_exists', path: 'env.txt' },
      required: true,
      stability: 'environmental',
      retry: { max_attempts: 2, backoff_ms: 50 },
    }];

    const failedResults: AssertionResult[] = [{
      assertion_id: 'a-env',
      type: 'file_exists',
      stability: 'environmental',
      passed: false,
      attempts: 1,
      duration_ms: 5,
      expected: 'exists',
      actual: 'not found',
    }];

    const drifts: DriftVector[] = [makeDrift('assertion_environmental', 'a-env')];

    const result = await retryFlakyAssertions(
      assertions, failedResults, drifts, sandbox, mockLogger, RUN_ID,
    );

    expect(result.resolved).toHaveLength(1);
    expect(result.remaining).toHaveLength(0);
  });

  it('handles mixed retryable and non-retryable drifts', async () => {
    await sandbox.writeFile('target.txt', 'data');

    const assertions: Assertion[] = [{
      assertion_id: 'a-flaky',
      type: 'file_exists',
      description: 'file exists',
      spec: { type: 'file_exists', path: 'target.txt' },
      required: true,
      stability: 'flaky',
      retry: { max_attempts: 1, backoff_ms: 50 },
    }];

    const failedResults: AssertionResult[] = [{
      assertion_id: 'a-flaky',
      type: 'file_exists',
      stability: 'flaky',
      passed: false,
      attempts: 1,
      duration_ms: 5,
      expected: 'exists',
      actual: 'not found',
    }];

    const drifts: DriftVector[] = [
      makeDrift('assertion_flaky', 'a-flaky'),
      makeDrift('assertion_stable', 'a-stable'), // not retryable
    ];

    const result = await retryFlakyAssertions(
      assertions, failedResults, drifts, sandbox, mockLogger, RUN_ID,
    );

    // Flaky resolved, stable remains
    expect(result.resolved).toHaveLength(1);
    expect(result.remaining.some((d) => d.category === 'assertion_stable')).toBe(true);
  });

  it('preserves non-retried assertion results', async () => {
    const assertions: Assertion[] = [];
    const failedResults: AssertionResult[] = [{
      assertion_id: 'a-stable',
      type: 'exit_code',
      stability: 'stable',
      passed: false,
      attempts: 1,
      duration_ms: 10,
      expected: 'exit 0',
      actual: 'exit 1',
    }];

    const drifts: DriftVector[] = [makeDrift('assertion_stable', 'a-stable')];

    const result = await retryFlakyAssertions(
      assertions, failedResults, drifts, sandbox, mockLogger, RUN_ID,
    );

    expect(result.updatedResults).toEqual(failedResults);
  });
});
