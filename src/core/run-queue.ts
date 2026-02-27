/**
 * Run queue — queue multiple runs with priority, execute in order,
 * persist queue state across process restarts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBaseDir } from './paths.js';

/** Priority levels for queued runs */
export type RunPriority = 'critical' | 'high' | 'normal' | 'low';

const PRIORITY_WEIGHT: Record<RunPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Status of a queued run */
export type QueuedRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** A run entry in the queue */
export interface QueuedRun {
  /** Unique queue entry ID */
  queueId: string;
  /** Plan file path or plan hash */
  planSource: string;
  /** Priority */
  priority: RunPriority;
  /** Current status */
  status: QueuedRunStatus;
  /** When enqueued */
  enqueuedAt: string;
  /** When execution started */
  startedAt?: string;
  /** When execution completed */
  completedAt?: string;
  /** Run ID (set after execution starts) */
  runId?: string;
  /** Error message if failed */
  error?: string;
  /** Optional label */
  label?: string;
  /** Run options (workspace, dry-run, etc.) */
  options?: Record<string, unknown>;
}

/** Queue state */
export interface QueueState {
  entries: QueuedRun[];
  lastUpdated: string;
}

function getQueuePath(): string {
  return join(getBaseDir(), 'run-queue.json');
}

/**
 * Load queue state from disk.
 */
export function loadQueue(): QueueState {
  const path = getQueuePath();
  if (!existsSync(path)) {
    return { entries: [], lastUpdated: new Date().toISOString() };
  }
  return JSON.parse(readFileSync(path, 'utf8')) as QueueState;
}

/**
 * Save queue state to disk.
 */
function saveQueue(state: QueueState): void {
  const dir = getBaseDir();
  mkdirSync(dir, { recursive: true });
  state.lastUpdated = new Date().toISOString();
  writeFileSync(getQueuePath(), JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Enqueue a run.
 */
export function enqueueRun(
  planSource: string,
  options?: {
    priority?: RunPriority;
    label?: string;
    runOptions?: Record<string, unknown>;
  },
): QueuedRun {
  const state = loadQueue();
  const entry: QueuedRun = {
    queueId: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    planSource,
    priority: options?.priority ?? 'normal',
    status: 'queued',
    enqueuedAt: new Date().toISOString(),
    label: options?.label,
    options: options?.runOptions,
  };

  state.entries.push(entry);
  saveQueue(state);
  return entry;
}

/**
 * Get the next queued run (highest priority, oldest first).
 */
export function dequeueNext(): QueuedRun | null {
  const state = loadQueue();
  const queued = state.entries
    .filter((e) => e.status === 'queued')
    .sort((a, b) => {
      const pw = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      if (pw !== 0) return pw;
      return a.enqueuedAt.localeCompare(b.enqueuedAt);
    });

  if (queued.length === 0) return null;

  const next = queued[0];
  next.status = 'running';
  next.startedAt = new Date().toISOString();
  saveQueue(state);

  return next;
}

/**
 * Mark a queued run as completed.
 */
export function completeQueuedRun(queueId: string, runId: string): boolean {
  const state = loadQueue();
  const entry = state.entries.find((e) => e.queueId === queueId);
  if (!entry) return false;

  entry.status = 'completed';
  entry.completedAt = new Date().toISOString();
  entry.runId = runId;
  saveQueue(state);
  return true;
}

/**
 * Mark a queued run as failed.
 */
export function failQueuedRun(queueId: string, error: string): boolean {
  const state = loadQueue();
  const entry = state.entries.find((e) => e.queueId === queueId);
  if (!entry) return false;

  entry.status = 'failed';
  entry.completedAt = new Date().toISOString();
  entry.error = error;
  saveQueue(state);
  return true;
}

/**
 * Cancel a queued run.
 */
export function cancelQueuedRun(queueId: string): boolean {
  const state = loadQueue();
  const entry = state.entries.find((e) => e.queueId === queueId && e.status === 'queued');
  if (!entry) return false;

  entry.status = 'cancelled';
  entry.completedAt = new Date().toISOString();
  saveQueue(state);
  return true;
}

/**
 * Reorder a queued run's priority.
 */
export function reprioritizeRun(queueId: string, priority: RunPriority): boolean {
  const state = loadQueue();
  const entry = state.entries.find((e) => e.queueId === queueId && e.status === 'queued');
  if (!entry) return false;

  entry.priority = priority;
  saveQueue(state);
  return true;
}

/**
 * List queue entries, optionally filtered by status.
 */
export function listQueue(filter?: { status?: QueuedRunStatus }): QueuedRun[] {
  const state = loadQueue();
  let entries = state.entries;

  if (filter?.status) {
    entries = entries.filter((e) => e.status === filter.status);
  }

  return entries.sort((a, b) => {
    const pw = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
    if (pw !== 0) return pw;
    return a.enqueuedAt.localeCompare(b.enqueuedAt);
  });
}

/**
 * Get queue statistics.
 */
export function getQueueStats(): {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
} {
  const state = loadQueue();
  return {
    queued: state.entries.filter((e) => e.status === 'queued').length,
    running: state.entries.filter((e) => e.status === 'running').length,
    completed: state.entries.filter((e) => e.status === 'completed').length,
    failed: state.entries.filter((e) => e.status === 'failed').length,
    cancelled: state.entries.filter((e) => e.status === 'cancelled').length,
  };
}

/**
 * Purge completed/failed/cancelled entries.
 */
export function purgeQueue(options?: { keepLast?: number }): number {
  const state = loadQueue();
  const keep = options?.keepLast ?? 0;
  const before = state.entries.length;

  const terminal = state.entries.filter(
    (e) => e.status === 'completed' || e.status === 'failed' || e.status === 'cancelled',
  );

  const toPurge = keep > 0
    ? terminal.slice(0, Math.max(0, terminal.length - keep))
    : terminal;

  const purgeIds = new Set(toPurge.map((e) => e.queueId));
  state.entries = state.entries.filter((e) => !purgeIds.has(e.queueId));
  saveQueue(state);

  return before - state.entries.length;
}

/**
 * Format queue for display.
 */
export function formatQueue(entries: QueuedRun[]): string {
  if (entries.length === 0) return 'Queue is empty.';

  const lines: string[] = [];
  for (const e of entries) {
    const status = e.status.toUpperCase().padEnd(10);
    const priority = e.priority.padEnd(8);
    const label = e.label ? ` (${e.label})` : '';
    lines.push(`  ${e.queueId}  ${status} ${priority} ${e.planSource}${label}`);
  }
  return lines.join('\n');
}
