import type { RunSummary, RunStatus } from '../types/run-summary.js';
import { listRunSummaries } from './runs.js';

/** Filter criteria for querying runs */
export interface RunQuery {
  /** Filter by status */
  status?: RunStatus | RunStatus[];
  /** Filter by task_id */
  taskId?: string;
  /** Filter runs started after this ISO date */
  after?: string;
  /** Filter runs started before this ISO date */
  before?: string;
  /** Filter by plan source */
  planSource?: 'llm' | 'cache' | 'file';
  /** Maximum number of results */
  limit?: number;
  /** Sort order. Default: 'desc' (newest first) */
  sortOrder?: 'asc' | 'desc';
  /** Minimum duration in ms */
  minDurationMs?: number;
  /** Search prompt text (case-insensitive substring match) */
  promptContains?: string;
}

/** Aggregated statistics across runs */
export interface RunStats {
  totalRuns: number;
  byStatus: Record<string, number>;
  avgDurationMs: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalCostUsd: number;
  oldestRun?: string;
  newestRun?: string;
}

/**
 * Query runs with flexible filters.
 * Loads all summaries, applies filters, sorts, and limits.
 */
export function queryRuns(query: RunQuery): RunSummary[] {
  let runs = listRunSummaries();

  // Apply filters
  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    runs = runs.filter((r) => statuses.includes(r.status));
  }

  if (query.taskId) {
    runs = runs.filter((r) => r.task_id === query.taskId);
  }

  if (query.after) {
    runs = runs.filter((r) => r.started_at >= query.after!);
  }

  if (query.before) {
    runs = runs.filter((r) => r.started_at <= query.before!);
  }

  if (query.planSource) {
    runs = runs.filter((r) => r.plan_source === query.planSource);
  }

  if (query.minDurationMs !== undefined) {
    runs = runs.filter((r) => (r.duration_ms ?? 0) >= query.minDurationMs!);
  }

  if (query.promptContains) {
    const needle = query.promptContains.toLowerCase();
    runs = runs.filter((r) => r.prompt.toLowerCase().includes(needle));
  }

  // Sort
  const order = query.sortOrder ?? 'desc';
  runs.sort((a, b) => {
    const cmp = a.started_at.localeCompare(b.started_at);
    return order === 'desc' ? -cmp : cmp;
  });

  // Limit
  if (query.limit && query.limit > 0) {
    runs = runs.slice(0, query.limit);
  }

  return runs;
}

/**
 * Compute aggregate statistics for a set of runs.
 */
export function computeRunStats(runs: RunSummary[]): RunStats {
  const byStatus: Record<string, number> = {};
  let totalDuration = 0;
  let durationCount = 0;
  let totalTokensInput = 0;
  let totalTokensOutput = 0;
  let totalCostUsd = 0;

  for (const run of runs) {
    byStatus[run.status] = (byStatus[run.status] ?? 0) + 1;

    if (run.duration_ms !== undefined) {
      totalDuration += run.duration_ms;
      durationCount++;
    }

    if (run.token_usage) {
      totalTokensInput += run.token_usage.input_tokens;
      totalTokensOutput += run.token_usage.output_tokens;
      totalCostUsd += run.token_usage.estimated_cost_usd ?? 0;
    }
  }

  return {
    totalRuns: runs.length,
    byStatus,
    avgDurationMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
    totalTokensInput,
    totalTokensOutput,
    totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    oldestRun: runs.length > 0 ? runs.reduce((oldest, r) =>
      r.started_at < oldest ? r.started_at : oldest, runs[0].started_at) : undefined,
    newestRun: runs.length > 0 ? runs.reduce((newest, r) =>
      r.started_at > newest ? r.started_at : newest, runs[0].started_at) : undefined,
  };
}
