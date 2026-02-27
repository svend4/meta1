import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  enqueueRun,
  dequeueNext,
  completeQueuedRun,
  failQueuedRun,
  cancelQueuedRun,
  reprioritizeRun,
  listQueue,
  getQueueStats,
  purgeQueue,
  formatQueue,
  loadQueue,
} from '../../src/core/run-queue.js';

let tempDir: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
}));

describe('run-queue', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-queue-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('enqueues a run', () => {
    const entry = enqueueRun('plan.json', { label: 'Test' });

    expect(entry.queueId).toMatch(/^q-/);
    expect(entry.status).toBe('queued');
    expect(entry.priority).toBe('normal');
    expect(entry.label).toBe('Test');
  });

  it('dequeues by priority', () => {
    enqueueRun('low.json', { priority: 'low' });
    enqueueRun('high.json', { priority: 'high' });
    enqueueRun('critical.json', { priority: 'critical' });

    const next = dequeueNext();
    expect(next).toBeDefined();
    expect(next!.planSource).toBe('critical.json');
    expect(next!.status).toBe('running');
  });

  it('dequeues by FIFO within same priority', () => {
    enqueueRun('first.json');
    enqueueRun('second.json');

    const next = dequeueNext();
    expect(next!.planSource).toBe('first.json');
  });

  it('returns null when queue empty', () => {
    expect(dequeueNext()).toBeNull();
  });

  it('completes a queued run', () => {
    const entry = enqueueRun('plan.json');
    dequeueNext(); // Mark as running

    const ok = completeQueuedRun(entry.queueId, 'run-123');
    expect(ok).toBe(true);

    const state = loadQueue();
    const completed = state.entries.find((e) => e.queueId === entry.queueId);
    expect(completed!.status).toBe('completed');
    expect(completed!.runId).toBe('run-123');
  });

  it('fails a queued run', () => {
    const entry = enqueueRun('plan.json');
    dequeueNext();

    failQueuedRun(entry.queueId, 'Step 3 failed');

    const state = loadQueue();
    const failed = state.entries.find((e) => e.queueId === entry.queueId);
    expect(failed!.status).toBe('failed');
    expect(failed!.error).toBe('Step 3 failed');
  });

  it('cancels a queued run', () => {
    const entry = enqueueRun('plan.json');

    expect(cancelQueuedRun(entry.queueId)).toBe(true);

    const state = loadQueue();
    expect(state.entries[0].status).toBe('cancelled');
  });

  it('cannot cancel a running run', () => {
    const entry = enqueueRun('plan.json');
    dequeueNext(); // Now running

    expect(cancelQueuedRun(entry.queueId)).toBe(false);
  });

  it('reprioritizes a queued run', () => {
    const entry = enqueueRun('plan.json', { priority: 'low' });
    expect(reprioritizeRun(entry.queueId, 'critical')).toBe(true);

    const state = loadQueue();
    expect(state.entries[0].priority).toBe('critical');
  });

  it('lists queue entries filtered by status', () => {
    enqueueRun('a.json');
    enqueueRun('b.json');
    dequeueNext(); // One running

    const queued = listQueue({ status: 'queued' });
    expect(queued).toHaveLength(1);

    const all = listQueue();
    expect(all).toHaveLength(2);
  });

  it('reports queue stats', () => {
    enqueueRun('a.json');
    enqueueRun('b.json');
    const entry = enqueueRun('c.json');
    dequeueNext();
    cancelQueuedRun(entry.queueId);

    const stats = getQueueStats();
    expect(stats.queued).toBe(1);
    expect(stats.running).toBe(1);
    expect(stats.cancelled).toBe(1);
  });

  it('purges terminal entries', () => {
    const e1 = enqueueRun('a.json');
    const e2 = enqueueRun('b.json');
    cancelQueuedRun(e1.queueId);
    cancelQueuedRun(e2.queueId);

    const removed = purgeQueue();
    expect(removed).toBe(2);
    expect(loadQueue().entries).toHaveLength(0);
  });

  it('purges with keep-last', () => {
    const e1 = enqueueRun('a.json');
    const e2 = enqueueRun('b.json');
    cancelQueuedRun(e1.queueId);
    cancelQueuedRun(e2.queueId);

    const removed = purgeQueue({ keepLast: 1 });
    expect(removed).toBe(1);
    expect(loadQueue().entries).toHaveLength(1);
  });

  it('formats queue', () => {
    enqueueRun('plan.json', { label: 'Build', priority: 'high' });
    const entries = listQueue();
    const output = formatQueue(entries);
    expect(output).toContain('plan.json');
    expect(output).toContain('Build');
    expect(output).toContain('high');
  });

  it('formats empty queue', () => {
    expect(formatQueue([])).toBe('Queue is empty.');
  });
});
