import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sendNotifications } from '../../src/core/notifications.js';
import type { RunSummary } from '../../src/types/run-summary.js';
import type { JsonFileChannelConfig, DesktopChannelConfig } from '../../src/core/notifications.js';

let tempDir: string;

function makeRun(overrides?: Partial<RunSummary>): RunSummary {
  return {
    run_id: 'run-notify-test',
    task_id: 'task-1',
    prompt: 'test',
    status: 'completed',
    started_at: '2026-01-01T00:00:00Z',
    duration_ms: 5000,
    plan: { plan_id: 'p1', steps: [] },
    plan_hash: 'sha256:abc',
    plan_source: 'llm',
    steps: [],
    ...overrides,
  } as RunSummary;
}

describe('notifications', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-notify-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('sends json_file notification', async () => {
    const logPath = join(tempDir, 'notifications.jsonl');

    const results = await sendNotifications(
      [{ type: 'json_file', path: logPath } as JsonFileChannelConfig],
      makeRun(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].type).toBe('json_file');

    const content = readFileSync(logPath, 'utf8').trim();
    const payload = JSON.parse(content);
    expect(payload.run_id).toBe('run-notify-test');
    expect(payload.event).toBe('run_completed');
  });

  it('appends multiple notifications to json_file', async () => {
    const logPath = join(tempDir, 'notifications.jsonl');
    const channel: JsonFileChannelConfig = { type: 'json_file', path: logPath };

    await sendNotifications([channel], makeRun({ run_id: 'r1' }));
    await sendNotifications([channel], makeRun({ run_id: 'r2' }));

    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('filters by event type', async () => {
    const logPath = join(tempDir, 'filtered.jsonl');

    const results = await sendNotifications(
      [{ type: 'json_file', path: logPath, events: ['run_failed'] } as JsonFileChannelConfig],
      makeRun({ status: 'completed' }),
    );

    // Should skip because event is run_completed, not run_failed
    expect(results).toHaveLength(0);
    expect(existsSync(logPath)).toBe(false);
  });

  it('desktop notification writes to stderr', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const results = await sendNotifications(
      [{ type: 'desktop' } as DesktopChannelConfig],
      makeRun(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Continuum]'),
    );

    stderrSpy.mockRestore();
  });

  it('desktop notification includes status icon', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await sendNotifications(
      [{ type: 'desktop' } as DesktopChannelConfig],
      makeRun({ status: 'completed' }),
    );

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('✓'));

    stderrSpy.mockRestore();
  });

  it('sends to multiple channels', async () => {
    const logPath1 = join(tempDir, 'ch1.jsonl');
    const logPath2 = join(tempDir, 'ch2.jsonl');

    const results = await sendNotifications(
      [
        { type: 'json_file', path: logPath1, name: 'channel-1' } as JsonFileChannelConfig,
        { type: 'json_file', path: logPath2, name: 'channel-2' } as JsonFileChannelConfig,
      ],
      makeRun(),
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
    expect(existsSync(logPath1)).toBe(true);
    expect(existsSync(logPath2)).toBe(true);
  });

  it('uses channel name in results', async () => {
    const logPath = join(tempDir, 'named.jsonl');

    const results = await sendNotifications(
      [{ type: 'json_file', path: logPath, name: 'my-log' } as JsonFileChannelConfig],
      makeRun(),
    );

    expect(results[0].channel).toBe('my-log');
  });
});
