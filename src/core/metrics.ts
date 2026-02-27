import { listRunSummaries } from '../storage/runs.js';

/** Aggregate metrics across all runs */
export interface AggregateMetrics {
  /** Total number of runs */
  totalRuns: number;
  /** Counts by status */
  statusCounts: Record<string, number>;
  /** Overall success rate (completed + verified + healed / total) */
  successRate: number;
  /** Duration statistics in milliseconds */
  duration: {
    min: number;
    max: number;
    avg: number;
    median: number;
    p95: number;
  } | null;
  /** Token usage totals */
  tokens: {
    totalInput: number;
    totalOutput: number;
    totalCost: number;
    avgCostPerRun: number;
  } | null;
  /** Runs per day for the last 30 days */
  dailyActivity: Array<{ date: string; count: number }>;
  /** Step statistics */
  steps: {
    totalExecuted: number;
    totalFailed: number;
    stepFailureRate: number;
    avgStepsPerRun: number;
  };
  /** Time range of data */
  period: {
    from: string;
    to: string;
  } | null;
}

/** Options for computing metrics */
export interface MetricsOptions {
  /** Only include runs after this date (ISO 8601) */
  since?: string;
  /** Only include runs before this date (ISO 8601) */
  until?: string;
  /** Filter by plan source */
  planSource?: 'llm' | 'cache' | 'file';
}

const SUCCESS_STATUSES: Set<string> = new Set(['completed', 'verified', 'healed', 'benign_drift']);

/**
 * Compute aggregate metrics across all runs.
 */
export function computeMetrics(options?: MetricsOptions): AggregateMetrics {
  let runs = listRunSummaries();

  // Apply filters
  if (options?.since) {
    runs = runs.filter((r) => r.started_at >= options.since!);
  }
  if (options?.until) {
    runs = runs.filter((r) => r.started_at <= options.until!);
  }
  if (options?.planSource) {
    runs = runs.filter((r) => r.plan_source === options.planSource);
  }

  const totalRuns = runs.length;

  // Status counts
  const statusCounts: Record<string, number> = {};
  for (const run of runs) {
    statusCounts[run.status] = (statusCounts[run.status] ?? 0) + 1;
  }

  // Success rate
  const successCount = runs.filter((r) => SUCCESS_STATUSES.has(r.status)).length;
  const successRate = totalRuns > 0 ? successCount / totalRuns : 0;

  // Duration stats
  const durations = runs
    .map((r) => r.duration_ms)
    .filter((d): d is number => d !== undefined)
    .sort((a, b) => a - b);

  const duration = durations.length > 0 ? {
    min: durations[0],
    max: durations[durations.length - 1],
    avg: Math.round(durations.reduce((s, d) => s + d, 0) / durations.length),
    median: durations[Math.floor(durations.length / 2)],
    p95: durations[Math.floor(durations.length * 0.95)],
  } : null;

  // Token stats
  const runsWithTokens = runs.filter((r) => r.token_usage);
  const tokens = runsWithTokens.length > 0 ? {
    totalInput: runsWithTokens.reduce((s, r) => s + r.token_usage!.input_tokens, 0),
    totalOutput: runsWithTokens.reduce((s, r) => s + r.token_usage!.output_tokens, 0),
    totalCost: runsWithTokens.reduce((s, r) => s + (r.token_usage!.estimated_cost_usd ?? 0), 0),
    avgCostPerRun: runsWithTokens.reduce((s, r) => s + (r.token_usage!.estimated_cost_usd ?? 0), 0) / runsWithTokens.length,
  } : null;

  // Daily activity (last 30 days)
  const dailyMap = new Map<string, number>();
  for (const run of runs) {
    const date = run.started_at.slice(0, 10);
    dailyMap.set(date, (dailyMap.get(date) ?? 0) + 1);
  }
  const dailyActivity = Array.from(dailyMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  // Step stats
  const allSteps = runs.flatMap((r) => r.steps);
  const executedSteps = allSteps.filter((s) => s.status !== 'skipped');
  const failedSteps = allSteps.filter((s) => s.status === 'failed');

  const steps = {
    totalExecuted: executedSteps.length,
    totalFailed: failedSteps.length,
    stepFailureRate: executedSteps.length > 0 ? failedSteps.length / executedSteps.length : 0,
    avgStepsPerRun: totalRuns > 0 ? allSteps.length / totalRuns : 0,
  };

  // Period
  const period = runs.length > 0 ? {
    from: runs[0].started_at,
    to: runs[runs.length - 1].started_at,
  } : null;

  return {
    totalRuns,
    statusCounts,
    successRate,
    duration,
    tokens,
    dailyActivity,
    steps,
    period,
  };
}

/**
 * Format metrics as a human-readable string.
 */
export function formatMetrics(m: AggregateMetrics): string {
  const lines: string[] = [];

  lines.push('Continuum Metrics');
  lines.push('');

  if (m.period) {
    lines.push(`  Period: ${m.period.from.slice(0, 10)} to ${m.period.to.slice(0, 10)}`);
  }
  lines.push(`  Total runs: ${m.totalRuns}`);
  lines.push(`  Success rate: ${(m.successRate * 100).toFixed(1)}%`);
  lines.push('');

  lines.push('  Status breakdown:');
  for (const [status, count] of Object.entries(m.statusCounts).sort((a, b) => b[1] - a[1])) {
    const pct = m.totalRuns > 0 ? ((count / m.totalRuns) * 100).toFixed(1) : '0.0';
    lines.push(`    ${status}: ${count} (${pct}%)`);
  }

  if (m.duration) {
    lines.push('');
    lines.push('  Duration:');
    lines.push(`    min: ${formatMs(m.duration.min)}`);
    lines.push(`    avg: ${formatMs(m.duration.avg)}`);
    lines.push(`    median: ${formatMs(m.duration.median)}`);
    lines.push(`    p95: ${formatMs(m.duration.p95)}`);
    lines.push(`    max: ${formatMs(m.duration.max)}`);
  }

  if (m.tokens) {
    lines.push('');
    lines.push('  Token usage:');
    lines.push(`    input: ${m.tokens.totalInput.toLocaleString()} tokens`);
    lines.push(`    output: ${m.tokens.totalOutput.toLocaleString()} tokens`);
    lines.push(`    total cost: $${m.tokens.totalCost.toFixed(4)}`);
    lines.push(`    avg cost/run: $${m.tokens.avgCostPerRun.toFixed(4)}`);
  }

  lines.push('');
  lines.push('  Steps:');
  lines.push(`    total executed: ${m.steps.totalExecuted}`);
  lines.push(`    failed: ${m.steps.totalFailed}`);
  lines.push(`    failure rate: ${(m.steps.stepFailureRate * 100).toFixed(1)}%`);
  lines.push(`    avg steps/run: ${m.steps.avgStepsPerRun.toFixed(1)}`);

  if (m.dailyActivity.length > 0) {
    lines.push('');
    lines.push('  Daily activity (last 30d):');
    const maxCount = Math.max(...m.dailyActivity.map((d) => d.count));
    const barWidth = 30;
    for (const { date, count } of m.dailyActivity.slice(-14)) {
      const bar = '█'.repeat(Math.max(1, Math.round((count / maxCount) * barWidth)));
      lines.push(`    ${date} ${bar} ${count}`);
    }
  }

  return lines.join('\n');
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
