import { describe, it, expect } from 'vitest';
import { buildPayload, mapStatusToEvent } from '../../src/core/webhook.js';
import type { RunSummary } from '../../src/types/run-summary.js';

function makeSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: 'run-1',
    task_id: 'task-1',
    prompt: 'Test task',
    status: 'completed',
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:01:00Z',
    duration_ms: 60000,
    plan: {
      plan_id: 'plan-1',
      steps: [
        {
          step_id: 's1',
          type: 'create_file',
          description: 'File',
          path: 'a.txt',
          content: 'hi',
          determinism: 'guaranteed',
        },
      ],
    },
    plan_hash: 'sha256:abc123' as `sha256:${string}`,
    plan_source: 'llm',
    run_hash: 'sha256:def456' as `sha256:${string}`,
    steps: [
      {
        step_id: 's1',
        type: 'create_file',
        status: 'completed',
        artifact_hash: 'sha256:111' as `sha256:${string}`,
        determinism: 'guaranteed',
      },
    ],
    ...overrides,
  };
}

describe('mapStatusToEvent', () => {
  it('maps completed to run_completed', () => {
    expect(mapStatusToEvent('completed')).toBe('run_completed');
  });

  it('maps failed to run_failed', () => {
    expect(mapStatusToEvent('failed')).toBe('run_failed');
  });

  it('maps verified to run_verified', () => {
    expect(mapStatusToEvent('verified')).toBe('run_verified');
  });

  it('maps healed to run_healed', () => {
    expect(mapStatusToEvent('healed')).toBe('run_healed');
  });

  it('maps assertion_failed to assertion_failed', () => {
    expect(mapStatusToEvent('assertion_failed')).toBe('assertion_failed');
  });

  it('maps benign_drift to run_completed', () => {
    expect(mapStatusToEvent('benign_drift')).toBe('run_completed');
  });
});

describe('buildPayload', () => {
  it('builds correct payload from summary', () => {
    const summary = makeSummary();
    const payload = buildPayload(summary);

    expect(payload.event).toBe('run_completed');
    expect(payload.run_id).toBe('run-1');
    expect(payload.task_id).toBe('task-1');
    expect(payload.status).toBe('completed');
    expect(payload.duration_ms).toBe(60000);
    expect(payload.plan_hash).toBe('sha256:abc123');
    expect(payload.run_hash).toBe('sha256:def456');
    expect(payload.steps_total).toBe(1);
    expect(payload.steps_failed).toBe(0);
    expect(payload.timestamp).toBeDefined();
  });

  it('counts failed steps correctly', () => {
    const summary = makeSummary({
      status: 'failed',
      steps: [
        { step_id: 's1', type: 'create_file', status: 'completed', determinism: 'guaranteed' },
        { step_id: 's2', type: 'run_command', status: 'failed', error: 'crash', determinism: 'best_effort' },
      ],
    });

    const payload = buildPayload(summary);
    expect(payload.event).toBe('run_failed');
    expect(payload.steps_total).toBe(2);
    expect(payload.steps_failed).toBe(1);
  });

  it('includes assertion counts when present', () => {
    const summary = makeSummary({
      status: 'verified',
      assertions_passed: 3,
      assertions_total: 4,
    });

    const payload = buildPayload(summary);
    expect(payload.event).toBe('run_verified');
    expect(payload.assertions_passed).toBe(3);
    expect(payload.assertions_total).toBe(4);
  });

  it('handles missing optional fields', () => {
    const summary = makeSummary({
      run_hash: undefined,
      duration_ms: undefined,
      assertions_passed: undefined,
      assertions_total: undefined,
    });

    const payload = buildPayload(summary);
    expect(payload.run_hash).toBeUndefined();
    expect(payload.duration_ms).toBeUndefined();
    expect(payload.assertions_passed).toBeUndefined();
    expect(payload.assertions_total).toBeUndefined();
  });
});
