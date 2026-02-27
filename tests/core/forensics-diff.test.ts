import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { diffForensics } from '../../src/core/forensics-diff.js';
import { ForensicsRecorder } from '../../src/core/forensics.js';
import * as paths from '../../src/core/paths.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-fdiff-'));
  vi.spyOn(paths, 'getBaseDir').mockReturnValue(tempDir);
  vi.spyOn(paths, 'getRunsDir').mockReturnValue(join(tempDir, 'runs'));
  vi.spyOn(paths, 'getRunDir').mockImplementation((runId: string) => join(tempDir, 'runs', runId));
  vi.spyOn(paths, 'getForensicsDir').mockImplementation((runId: string) => join(tempDir, 'runs', runId, 'forensics'));
  vi.spyOn(paths, 'getHttpForensicsDir').mockImplementation((runId: string, stepId: string) => join(tempDir, 'runs', runId, 'forensics', 'http', stepId));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('diffForensics', () => {
  it('returns empty diff when no forensics data exists', () => {
    const result = diffForensics('run-a', 'run-b');
    expect(result.steps).toHaveLength(0);
    expect(result.http_diff).toHaveLength(0);
    expect(result.summary.steps_changed).toBe(0);
  });

  it('detects different HTTP call counts between runs', () => {
    const runA = randomUUID();
    const runB = randomUUID();

    const recA = new ForensicsRecorder(runA);
    recA.recordHttp({
      step_id: 'step-1',
      method: 'GET',
      url: 'https://api.example.com/data',
      response: { status: 200 },
      duration_ms: 100,
    });
    recA.generateSummary();

    const recB = new ForensicsRecorder(runB);
    recB.recordHttp({
      step_id: 'step-1',
      method: 'GET',
      url: 'https://api.example.com/data',
      response: { status: 200 },
      duration_ms: 100,
    });
    recB.recordHttp({
      step_id: 'step-1',
      method: 'POST',
      url: 'https://api.example.com/submit',
      response: { status: 201 },
      duration_ms: 200,
    });
    recB.generateSummary();

    const result = diffForensics(runA, runB);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].http_calls.a).toBe(1);
    expect(result.steps[0].http_calls.b).toBe(2);
    expect(result.summary.steps_changed).toBe(1);
    expect(result.summary.http_calls_delta).toBe(1);
  });

  it('detects HTTP calls only in one run', () => {
    const runA = randomUUID();
    const runB = randomUUID();

    const recA = new ForensicsRecorder(runA);
    recA.recordHttp({
      step_id: 'step-1',
      method: 'GET',
      url: 'https://api.example.com/old-endpoint',
      response: { status: 200 },
      duration_ms: 100,
    });
    recA.generateSummary();

    const recB = new ForensicsRecorder(runB);
    recB.recordHttp({
      step_id: 'step-1',
      method: 'GET',
      url: 'https://api.example.com/new-endpoint',
      response: { status: 200 },
      duration_ms: 100,
    });
    recB.generateSummary();

    const result = diffForensics(runA, runB);

    expect(result.http_diff).toHaveLength(2);
    const onlyA = result.http_diff.find((d) => d.only_in === 'a');
    const onlyB = result.http_diff.find((d) => d.only_in === 'b');
    expect(onlyA?.url).toBe('https://api.example.com/old-endpoint');
    expect(onlyB?.url).toBe('https://api.example.com/new-endpoint');
  });

  it('detects new and resolved errors', () => {
    const runA = randomUUID();
    const runB = randomUUID();

    const recA = new ForensicsRecorder(runA);
    recA.recordHttp({
      step_id: 'step-1',
      method: 'GET',
      url: 'https://api.example.com/flaky',
      response: { status: 500 },
      duration_ms: 100,
      error: 'HTTP GET https://api.example.com/flaky: 500',
    });
    recA.generateSummary();

    // In run B, the error is resolved
    const recB = new ForensicsRecorder(runB);
    recB.recordHttp({
      step_id: 'step-1',
      method: 'GET',
      url: 'https://api.example.com/flaky',
      response: { status: 200 },
      duration_ms: 50,
    });
    recB.generateSummary();

    const result = diffForensics(runA, runB);
    expect(result.steps[0].resolved_errors).toHaveLength(1);
    expect(result.steps[0].new_errors).toHaveLength(0);
    expect(result.summary.resolved_errors).toBe(1);
  });

  it('detects steps only in one run', () => {
    const runA = randomUUID();
    const runB = randomUUID();

    const recA = new ForensicsRecorder(runA);
    recA.recordFs({ step_id: 'step-1', operation: 'create', path: '/tmp/a.txt' });
    recA.generateSummary();

    const recB = new ForensicsRecorder(runB);
    recB.recordFs({ step_id: 'step-1', operation: 'create', path: '/tmp/a.txt' });
    recB.recordFs({ step_id: 'step-2', operation: 'create', path: '/tmp/b.txt' });
    recB.generateSummary();

    const result = diffForensics(runA, runB);

    // step-2 only exists in B
    const step2 = result.steps.find((s) => s.step_id === 'step-2');
    expect(step2).toBeDefined();
    expect(step2!.fs_operations.a).toBe(0);
    expect(step2!.fs_operations.b).toBe(1);
  });

  it('identical runs produce no changes', () => {
    const runA = randomUUID();
    const runB = randomUUID();

    for (const runId of [runA, runB]) {
      const rec = new ForensicsRecorder(runId);
      rec.recordHttp({
        step_id: 'step-1',
        method: 'GET',
        url: 'https://api.example.com/data',
        response: { status: 200 },
        duration_ms: 100,
      });
      rec.recordFs({ step_id: 'step-1', operation: 'create', path: '/tmp/out.txt' });
      rec.generateSummary();
    }

    const result = diffForensics(runA, runB);

    expect(result.summary.steps_changed).toBe(0);
    expect(result.summary.http_calls_delta).toBe(0);
    expect(result.summary.fs_ops_delta).toBe(0);
    expect(result.http_diff).toHaveLength(0);
  });
});
