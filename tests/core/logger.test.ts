import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventLogger, createEvent } from '../../src/core/logger.js';
import * as paths from '../../src/core/paths.js';
import { vi } from 'vitest';

// Mock the base dir to use a temp directory
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-test-'));
  vi.spyOn(paths, 'getBaseDir').mockReturnValue(tempDir);
  vi.spyOn(paths, 'getRunsDir').mockReturnValue(join(tempDir, 'runs'));
  vi.spyOn(paths, 'getRunDir').mockImplementation((id) =>
    join(tempDir, 'runs', id),
  );
  vi.spyOn(paths, 'getEventsPath').mockImplementation((id) =>
    join(tempDir, 'runs', id, 'events.jsonl'),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('EventLogger', () => {
  it('creates event log file on first write', () => {
    const logger = new EventLogger('run-001');
    const event = createEvent('run_start', 'run-001', {
      task_id: 'task-1',
      prompt: 'build api',
    });
    logger.log(event);

    const content = readFileSync(logger.getPath(), 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe('run_start');
    expect(parsed.run_id).toBe('run-001');
    expect(parsed.prompt).toBe('build api');
  });

  it('appends multiple events', () => {
    const logger = new EventLogger('run-002');
    logger.log(
      createEvent('run_start', 'run-002', {
        task_id: 'task-1',
        prompt: 'test',
      }),
    );
    logger.log(
      createEvent('step_start', 'run-002', {
        step_id: 's1',
        step_type: 'create_file',
        step_index: 0,
      }),
    );
    logger.log(
      createEvent('step_complete', 'run-002', {
        step_id: 's1',
        artifact_hash: 'sha256:abc123',
        duration_ms: 100,
      }),
    );

    const content = readFileSync(logger.getPath(), 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).type).toBe('run_start');
    expect(JSON.parse(lines[1]).type).toBe('step_start');
    expect(JSON.parse(lines[2]).type).toBe('step_complete');
  });
});

describe('createEvent', () => {
  it('adds timestamp and run_id automatically', () => {
    const event = createEvent('run_start', 'run-123', {
      task_id: 'task-1',
      prompt: 'hello',
    });
    expect(event.type).toBe('run_start');
    expect(event.run_id).toBe('run-123');
    expect(event.ts).toBeDefined();
    expect(new Date(event.ts).getTime()).not.toBeNaN();
  });

  it('creates different event types correctly', () => {
    const cacheHit = createEvent('plan_cache_hit', 'run-1', {
      cache_key: 'sha256:aaa',
      plan_hash: 'sha256:bbb',
    });
    expect(cacheHit.type).toBe('plan_cache_hit');
    expect(cacheHit.cache_key).toBe('sha256:aaa');
  });
});
