import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ForensicsRecorder,
  loadForensicsSummary,
  loadHttpRecords,
} from '../../src/core/forensics.js';
import * as paths from '../../src/core/paths.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-forensics-test-'));

  // Redirect storage to temp dir
  vi.spyOn(paths, 'getForensicsDir').mockImplementation((runId) =>
    join(tempDir, 'runs', runId, 'forensics'),
  );
  vi.spyOn(paths, 'getHttpForensicsDir').mockImplementation((runId, stepId) =>
    join(tempDir, 'runs', runId, 'forensics', 'http', stepId),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

const RUN_ID = 'test-forensics-run';

describe('ForensicsRecorder', () => {
  describe('constructor', () => {
    it('creates recorder with enabled=true by default', () => {
      const recorder = new ForensicsRecorder(RUN_ID);
      expect(recorder.isEnabled()).toBe(true);
    });

    it('can be created disabled', () => {
      const recorder = new ForensicsRecorder(RUN_ID, false);
      expect(recorder.isEnabled()).toBe(false);
    });
  });

  describe('recordHttp', () => {
    it('records HTTP call with auto-generated id and timestamp', () => {
      const recorder = new ForensicsRecorder(RUN_ID);
      recorder.recordHttp({
        step_id: 'step-1',
        method: 'GET',
        url: 'http://localhost:3000/api/users',
        response: { status: 200 },
        duration_ms: 42,
      });

      const records = recorder.getHttpRecords();
      expect(records).toHaveLength(1);
      expect(records[0].record_id).toBeDefined();
      expect(records[0].timestamp).toBeDefined();
      expect(records[0].method).toBe('GET');
      expect(records[0].url).toBe('http://localhost:3000/api/users');
      expect(records[0].response.status).toBe(200);
      expect(records[0].duration_ms).toBe(42);
    });

    it('persists HTTP record to disk', () => {
      const recorder = new ForensicsRecorder(RUN_ID);
      recorder.recordHttp({
        step_id: 'step-1',
        method: 'POST',
        url: 'http://localhost:3000/api/data',
        request_body: '{"key": "value"}',
        response: { status: 201, body_preview: '{"id": 1}' },
        duration_ms: 150,
      });

      const httpDir = join(tempDir, 'runs', RUN_ID, 'forensics', 'http', 'step-1');
      expect(existsSync(httpDir)).toBe(true);

      const files = readdirSync(httpDir);
      expect(files).toHaveLength(1);

      const saved = JSON.parse(readFileSync(join(httpDir, files[0]), 'utf8'));
      expect(saved.method).toBe('POST');
      expect(saved.response.status).toBe(201);
    });

    it('does nothing when disabled', () => {
      const recorder = new ForensicsRecorder(RUN_ID, false);
      recorder.recordHttp({
        step_id: 'step-1',
        method: 'GET',
        url: 'http://localhost:3000',
        response: { status: 200 },
        duration_ms: 10,
      });

      expect(recorder.getHttpRecords()).toHaveLength(0);
    });

    it('records multiple calls and groups by step', () => {
      const recorder = new ForensicsRecorder(RUN_ID);

      recorder.recordHttp({
        step_id: 'step-1',
        method: 'GET',
        url: '/api/1',
        response: { status: 200 },
        duration_ms: 10,
      });
      recorder.recordHttp({
        step_id: 'step-1',
        method: 'GET',
        url: '/api/2',
        response: { status: 200 },
        duration_ms: 20,
      });
      recorder.recordHttp({
        step_id: 'step-2',
        method: 'POST',
        url: '/api/3',
        response: { status: 201 },
        duration_ms: 30,
      });

      expect(recorder.getHttpRecords('step-1')).toHaveLength(2);
      expect(recorder.getHttpRecords('step-2')).toHaveLength(1);
      expect(recorder.getHttpRecords()).toHaveLength(3);
    });
  });

  describe('recordFs', () => {
    it('records filesystem operation', () => {
      const recorder = new ForensicsRecorder(RUN_ID);
      recorder.recordFs({
        step_id: 'step-1',
        operation: 'create',
        path: 'src/index.ts',
        size_bytes: 1024,
        content_hash: 'sha256:abc',
      });

      const records = recorder.getFsRecords();
      expect(records).toHaveLength(1);
      expect(records[0].operation).toBe('create');
      expect(records[0].path).toBe('src/index.ts');
      expect(records[0].size_bytes).toBe(1024);
    });

    it('persists FS record to disk', () => {
      const recorder = new ForensicsRecorder(RUN_ID);
      recorder.recordFs({
        step_id: 'step-1',
        operation: 'write',
        path: 'config.json',
      });

      const fsDir = join(tempDir, 'runs', RUN_ID, 'forensics', 'fs', 'step-1');
      expect(existsSync(fsDir)).toBe(true);

      const files = readdirSync(fsDir);
      expect(files).toHaveLength(1);
    });

    it('filters FS records by step_id', () => {
      const recorder = new ForensicsRecorder(RUN_ID);
      recorder.recordFs({ step_id: 'step-1', operation: 'create', path: 'a.txt' });
      recorder.recordFs({ step_id: 'step-2', operation: 'create', path: 'b.txt' });

      expect(recorder.getFsRecords('step-1')).toHaveLength(1);
      expect(recorder.getFsRecords('step-2')).toHaveLength(1);
    });
  });

  describe('generateSummary', () => {
    it('produces correct summary with counts', () => {
      const recorder = new ForensicsRecorder(RUN_ID);

      recorder.recordHttp({
        step_id: 'step-1',
        method: 'GET',
        url: '/api/health',
        response: { status: 200 },
        duration_ms: 50,
      });
      recorder.recordHttp({
        step_id: 'step-1',
        method: 'POST',
        url: '/api/data',
        response: { status: 500 },
        duration_ms: 200,
        error: 'Internal Server Error',
      });
      recorder.recordFs({
        step_id: 'step-1',
        operation: 'create',
        path: 'output.json',
      });

      const summary = recorder.generateSummary();

      expect(summary.run_id).toBe(RUN_ID);
      expect(summary.total_http_calls).toBe(2);
      expect(summary.total_fs_operations).toBe(1);
      expect(summary.steps).toHaveLength(1);
      expect(summary.steps[0].step_id).toBe('step-1');
      expect(summary.steps[0].http_calls).toBe(2);
      expect(summary.steps[0].fs_operations).toBe(1);
      expect(summary.steps[0].total_duration_ms).toBe(250);
      expect(summary.steps[0].errors).toHaveLength(1);
    });

    it('creates timeline in chronological order', () => {
      const recorder = new ForensicsRecorder(RUN_ID);

      recorder.recordHttp({
        step_id: 'step-1',
        method: 'GET',
        url: '/first',
        response: { status: 200 },
        duration_ms: 10,
      });
      recorder.recordFs({
        step_id: 'step-1',
        operation: 'create',
        path: 'file.txt',
      });
      recorder.recordHttp({
        step_id: 'step-2',
        method: 'POST',
        url: '/second',
        response: { status: 201 },
        duration_ms: 20,
      });

      const summary = recorder.generateSummary();
      expect(summary.timeline.length).toBe(3);

      // Timeline should be sorted by timestamp
      for (let i = 1; i < summary.timeline.length; i++) {
        expect(summary.timeline[i].timestamp >= summary.timeline[i - 1].timestamp).toBe(true);
      }
    });

    it('saves summary to disk', () => {
      const recorder = new ForensicsRecorder(RUN_ID);
      recorder.recordHttp({
        step_id: 'step-1',
        method: 'GET',
        url: '/test',
        response: { status: 200 },
        duration_ms: 5,
      });

      recorder.generateSummary();

      const summaryPath = join(tempDir, 'runs', RUN_ID, 'forensics', 'summary.json');
      expect(existsSync(summaryPath)).toBe(true);

      const saved = JSON.parse(readFileSync(summaryPath, 'utf8'));
      expect(saved.run_id).toBe(RUN_ID);
    });

    it('handles empty recorder gracefully', () => {
      const recorder = new ForensicsRecorder(RUN_ID);
      const summary = recorder.generateSummary();

      expect(summary.total_http_calls).toBe(0);
      expect(summary.total_fs_operations).toBe(0);
      expect(summary.steps).toHaveLength(0);
      expect(summary.timeline).toHaveLength(0);
    });

    it('groups steps correctly for multi-step runs', () => {
      const recorder = new ForensicsRecorder(RUN_ID);

      recorder.recordHttp({ step_id: 'install', method: 'GET', url: '/npm', response: { status: 200 }, duration_ms: 100 });
      recorder.recordFs({ step_id: 'install', operation: 'create', path: 'package.json' });
      recorder.recordHttp({ step_id: 'test', method: 'GET', url: '/check', response: { status: 200 }, duration_ms: 50 });
      recorder.recordFs({ step_id: 'test', operation: 'write', path: 'coverage.json' });

      const summary = recorder.generateSummary();
      expect(summary.steps).toHaveLength(2);

      const installStep = summary.steps.find((s) => s.step_id === 'install');
      const testStep = summary.steps.find((s) => s.step_id === 'test');
      expect(installStep).toBeDefined();
      expect(testStep).toBeDefined();
      expect(installStep!.http_calls).toBe(1);
      expect(testStep!.http_calls).toBe(1);
    });
  });
});

describe('loadForensicsSummary', () => {
  it('loads previously saved summary', () => {
    const recorder = new ForensicsRecorder(RUN_ID);
    recorder.recordHttp({
      step_id: 'step-1',
      method: 'GET',
      url: '/api',
      response: { status: 200 },
      duration_ms: 30,
    });
    recorder.generateSummary();

    const loaded = loadForensicsSummary(RUN_ID);
    expect(loaded).not.toBeNull();
    expect(loaded!.run_id).toBe(RUN_ID);
    expect(loaded!.total_http_calls).toBe(1);
  });

  it('returns null when no summary exists', () => {
    const loaded = loadForensicsSummary('nonexistent-run');
    expect(loaded).toBeNull();
  });
});

describe('loadHttpRecords', () => {
  it('loads all HTTP records from disk', () => {
    const recorder = new ForensicsRecorder(RUN_ID);
    recorder.recordHttp({
      step_id: 'step-1',
      method: 'GET',
      url: '/first',
      response: { status: 200 },
      duration_ms: 10,
    });
    recorder.recordHttp({
      step_id: 'step-2',
      method: 'POST',
      url: '/second',
      response: { status: 201 },
      duration_ms: 20,
    });

    const records = loadHttpRecords(RUN_ID);
    expect(records).toHaveLength(2);
    expect(records[0].timestamp <= records[1].timestamp).toBe(true);
  });

  it('filters by step_id', () => {
    const recorder = new ForensicsRecorder(RUN_ID);
    recorder.recordHttp({
      step_id: 'step-1',
      method: 'GET',
      url: '/one',
      response: { status: 200 },
      duration_ms: 5,
    });
    recorder.recordHttp({
      step_id: 'step-2',
      method: 'GET',
      url: '/two',
      response: { status: 200 },
      duration_ms: 5,
    });

    const step1Records = loadHttpRecords(RUN_ID, 'step-1');
    expect(step1Records).toHaveLength(1);
    expect(step1Records[0].step_id).toBe('step-1');
  });

  it('returns empty array for nonexistent run', () => {
    const records = loadHttpRecords('nonexistent');
    expect(records).toHaveLength(0);
  });
});
