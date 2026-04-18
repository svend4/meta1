import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readEvents, readEventsOfType } from '../../src/storage/events.js';
import * as paths from '../../src/core/paths.js';
import type { Event } from '../../src/types/events.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-events-test-'));
  vi.spyOn(paths, 'getEventsPath').mockImplementation(
    (runId: string) => join(tempDir, 'runs', runId, 'events.jsonl'),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

function writeEvents(runId: string, events: Event[]): void {
  const dir = join(tempDir, 'runs', runId);
  mkdirSync(dir, { recursive: true });
  const content = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(join(dir, 'events.jsonl'), content, 'utf8');
}

function makeStepStart(runId: string, stepId: string, index: number): Event {
  return {
    type: 'step_start',
    ts: new Date().toISOString(),
    run_id: runId,
    step_id: stepId,
    step_type: 'create_file',
    step_index: index,
  };
}

function makeStepComplete(runId: string, stepId: string): Event {
  return {
    type: 'step_complete',
    ts: new Date().toISOString(),
    run_id: runId,
    step_id: stepId,
    artifact_hash: 'sha256:' + 'a'.repeat(64) as `sha256:${string}`,
    duration_ms: 10,
  };
}

function makeStepFailed(runId: string, stepId: string): Event {
  return {
    type: 'step_failed',
    ts: new Date().toISOString(),
    run_id: runId,
    step_id: stepId,
    error: 'Something went wrong',
    exit_code: 1,
  };
}

describe('readEvents', () => {
  it('reads all events from JSONL file', () => {
    const runId = 'test-run-1';
    const events: Event[] = [
      makeStepStart(runId, 'step-1', 0),
      makeStepComplete(runId, 'step-1'),
    ];
    writeEvents(runId, events);

    const loaded = readEvents(runId);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].type).toBe('step_start');
    expect(loaded[1].type).toBe('step_complete');
  });

  it('throws when run does not exist', () => {
    expect(() => readEvents('nonexistent-run')).toThrow(/not found/);
  });

  it('handles single event', () => {
    const runId = 'single-event';
    writeEvents(runId, [makeStepStart(runId, 'step-1', 0)]);

    const loaded = readEvents(runId);
    expect(loaded).toHaveLength(1);
  });

  it('preserves event fields', () => {
    const runId = 'fields-test';
    const event = makeStepFailed(runId, 'step-fail');
    writeEvents(runId, [event]);

    const loaded = readEvents(runId);
    const fail = loaded[0] as Extract<Event, { type: 'step_failed' }>;
    expect(fail.step_id).toBe('step-fail');
    expect(fail.error).toBe('Something went wrong');
    expect(fail.exit_code).toBe(1);
  });

  it('handles multiple event types', () => {
    const runId = 'mixed-events';
    const events: Event[] = [
      makeStepStart(runId, 'step-1', 0),
      makeStepComplete(runId, 'step-1'),
      makeStepStart(runId, 'step-2', 1),
      makeStepFailed(runId, 'step-2'),
    ];
    writeEvents(runId, events);

    const loaded = readEvents(runId);
    expect(loaded).toHaveLength(4);
    expect(loaded.map((e) => e.type)).toEqual([
      'step_start', 'step_complete', 'step_start', 'step_failed',
    ]);
  });

  it('ignores trailing newlines', () => {
    const runId = 'trailing-newlines';
    const dir = join(tempDir, 'runs', runId);
    mkdirSync(dir, { recursive: true });
    const event = makeStepStart(runId, 'step-1', 0);
    writeFileSync(
      join(dir, 'events.jsonl'),
      JSON.stringify(event) + '\n\n\n',
      'utf8',
    );

    const loaded = readEvents(runId);
    expect(loaded).toHaveLength(1);
  });
});

describe('readEventsOfType', () => {
  it('filters events by type', () => {
    const runId = 'filter-test';
    const events: Event[] = [
      makeStepStart(runId, 'step-1', 0),
      makeStepComplete(runId, 'step-1'),
      makeStepStart(runId, 'step-2', 1),
      makeStepFailed(runId, 'step-2'),
    ];
    writeEvents(runId, events);

    const starts = readEventsOfType(runId, 'step_start');
    expect(starts).toHaveLength(2);
    expect(starts[0].step_id).toBe('step-1');
    expect(starts[1].step_id).toBe('step-2');
  });

  it('returns empty array when no events match', () => {
    const runId = 'no-match';
    writeEvents(runId, [makeStepStart(runId, 'step-1', 0)]);

    const failed = readEventsOfType(runId, 'step_failed');
    expect(failed).toHaveLength(0);
  });

  it('returns typed events', () => {
    const runId = 'typed-test';
    writeEvents(runId, [makeStepComplete(runId, 'step-1')]);

    const completes = readEventsOfType(runId, 'step_complete');
    expect(completes).toHaveLength(1);
    // TypeScript should narrow this to StepCompleteEvent
    expect(completes[0].artifact_hash).toMatch(/^sha256:/);
    expect(completes[0].duration_ms).toBe(10);
  });

  it('filters v3.0 event types', () => {
    const runId = 'v3-filter';
    const events: Event[] = [
      makeStepStart(runId, 'step-1', 0),
      {
        type: 'assertion_passed',
        ts: new Date().toISOString(),
        run_id: runId,
        assertion_id: 'a1',
        assertion_type: 'file_exists',
        attempts: 1,
        duration_ms: 5,
      },
      {
        type: 'drift_detected',
        ts: new Date().toISOString(),
        run_id: runId,
        drift_id: 'd1',
        category: 'environment',
        severity: 'degraded',
        repairable: true,
        repair_level: 2,
      },
    ];
    writeEvents(runId, events);

    const assertions = readEventsOfType(runId, 'assertion_passed');
    expect(assertions).toHaveLength(1);
    expect(assertions[0].assertion_id).toBe('a1');

    const drifts = readEventsOfType(runId, 'drift_detected');
    expect(drifts).toHaveLength(1);
    expect(drifts[0].drift_id).toBe('d1');
  });
});
