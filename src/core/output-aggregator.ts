/**
 * Step output aggregator — collect/merge outputs from parallel steps,
 * apply reduce patterns (concat, merge, dedupe, summarize),
 * and generate summaries.
 */

/** A single step output entry */
export interface StepOutput {
  stepId: string;
  output: string;
  exitCode: number;
  durationMs: number;
  timestamp: string;
}

/** Aggregation strategy */
export type AggregationStrategy = 'concat' | 'merge-json' | 'dedupe-lines' | 'last-wins' | 'first-wins' | 'custom';

/** Configuration for output aggregation */
export interface AggregationConfig {
  strategy: AggregationStrategy;
  /** Separator for concat strategy */
  separator?: string;
  /** Sort outputs before aggregation */
  sort?: 'by-step' | 'by-time' | 'by-duration' | 'none';
  /** Custom reduce function */
  reducer?: (outputs: StepOutput[]) => string;
  /** Include step metadata in output */
  includeMetadata?: boolean;
}

/** Result of aggregation */
export interface AggregationResult {
  aggregatedOutput: string;
  strategy: AggregationStrategy;
  inputCount: number;
  totalDurationMs: number;
  summary: OutputSummary;
}

/** Summary statistics */
export interface OutputSummary {
  totalSteps: number;
  successfulSteps: number;
  failedSteps: number;
  totalOutputLines: number;
  totalOutputBytes: number;
  averageDurationMs: number;
  longestStep: { stepId: string; durationMs: number } | null;
  shortestStep: { stepId: string; durationMs: number } | null;
}

/**
 * Aggregate outputs from multiple steps.
 */
export function aggregateOutputs(
  outputs: StepOutput[],
  config?: AggregationConfig,
): AggregationResult {
  const conf: AggregationConfig = {
    strategy: 'concat',
    separator: '\n',
    sort: 'by-step',
    includeMetadata: false,
    ...config,
  };

  // Sort outputs
  const sorted = sortOutputs([...outputs], conf.sort ?? 'none');

  // Aggregate
  let aggregatedOutput: string;

  switch (conf.strategy) {
    case 'concat':
      aggregatedOutput = aggregateConcat(sorted, conf);
      break;
    case 'merge-json':
      aggregatedOutput = aggregateMergeJson(sorted);
      break;
    case 'dedupe-lines':
      aggregatedOutput = aggregateDedupeLines(sorted);
      break;
    case 'last-wins':
      aggregatedOutput = sorted.length > 0 ? sorted[sorted.length - 1].output : '';
      break;
    case 'first-wins':
      aggregatedOutput = sorted.length > 0 ? sorted[0].output : '';
      break;
    case 'custom':
      aggregatedOutput = conf.reducer ? conf.reducer(sorted) : '';
      break;
    default:
      aggregatedOutput = aggregateConcat(sorted, conf);
  }

  const summary = computeSummary(outputs);
  const totalDurationMs = outputs.reduce((sum, o) => sum + o.durationMs, 0);

  return {
    aggregatedOutput,
    strategy: conf.strategy,
    inputCount: outputs.length,
    totalDurationMs,
    summary,
  };
}

/**
 * Compute summary from step outputs.
 */
export function computeSummary(outputs: StepOutput[]): OutputSummary {
  const successful = outputs.filter((o) => o.exitCode === 0);
  const failed = outputs.filter((o) => o.exitCode !== 0);

  const totalOutputLines = outputs.reduce((sum, o) => sum + o.output.split('\n').length, 0);
  const totalOutputBytes = outputs.reduce((sum, o) => sum + Buffer.byteLength(o.output, 'utf8'), 0);
  const totalDuration = outputs.reduce((sum, o) => sum + o.durationMs, 0);
  const averageDurationMs = outputs.length > 0 ? Math.round(totalDuration / outputs.length) : 0;

  let longestStep: { stepId: string; durationMs: number } | null = null;
  let shortestStep: { stepId: string; durationMs: number } | null = null;

  for (const o of outputs) {
    if (!longestStep || o.durationMs > longestStep.durationMs) {
      longestStep = { stepId: o.stepId, durationMs: o.durationMs };
    }
    if (!shortestStep || o.durationMs < shortestStep.durationMs) {
      shortestStep = { stepId: o.stepId, durationMs: o.durationMs };
    }
  }

  return {
    totalSteps: outputs.length,
    successfulSteps: successful.length,
    failedSteps: failed.length,
    totalOutputLines,
    totalOutputBytes,
    averageDurationMs,
    longestStep,
    shortestStep,
  };
}

/**
 * Group outputs by a key (e.g., by exit code, by prefix).
 */
export function groupOutputs(
  outputs: StepOutput[],
  groupBy: 'exit-code' | 'status' | ((output: StepOutput) => string),
): Map<string, StepOutput[]> {
  const groups = new Map<string, StepOutput[]>();

  for (const o of outputs) {
    let key: string;

    if (typeof groupBy === 'function') {
      key = groupBy(o);
    } else if (groupBy === 'exit-code') {
      key = String(o.exitCode);
    } else {
      key = o.exitCode === 0 ? 'success' : 'failure';
    }

    const group = groups.get(key) ?? [];
    group.push(o);
    groups.set(key, group);
  }

  return groups;
}

/**
 * Format aggregation result for display.
 */
export function formatAggregation(result: AggregationResult): string {
  const lines: string[] = [];
  const s = result.summary;

  lines.push(`Aggregation: ${result.strategy} (${result.inputCount} steps)`);
  lines.push(`  Success: ${s.successfulSteps}, Failed: ${s.failedSteps}`);
  lines.push(`  Total duration: ${result.totalDurationMs}ms (avg: ${s.averageDurationMs}ms)`);
  lines.push(`  Output: ${s.totalOutputLines} lines, ${s.totalOutputBytes} bytes`);

  if (s.longestStep) {
    lines.push(`  Longest: ${s.longestStep.stepId} (${s.longestStep.durationMs}ms)`);
  }
  if (s.shortestStep) {
    lines.push(`  Shortest: ${s.shortestStep.stepId} (${s.shortestStep.durationMs}ms)`);
  }

  return lines.join('\n');
}

// ── Internal ──

function sortOutputs(outputs: StepOutput[], sort: string): StepOutput[] {
  switch (sort) {
    case 'by-step':
      return outputs.sort((a, b) => a.stepId.localeCompare(b.stepId));
    case 'by-time':
      return outputs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    case 'by-duration':
      return outputs.sort((a, b) => a.durationMs - b.durationMs);
    default:
      return outputs;
  }
}

function aggregateConcat(outputs: StepOutput[], config: AggregationConfig): string {
  const sep = config.separator ?? '\n';
  if (config.includeMetadata) {
    return outputs
      .map((o) => `--- ${o.stepId} (exit: ${o.exitCode}, ${o.durationMs}ms) ---\n${o.output}`)
      .join(sep);
  }
  return outputs.map((o) => o.output).join(sep);
}

function aggregateMergeJson(outputs: StepOutput[]): string {
  const merged: Record<string, unknown> = {};
  for (const o of outputs) {
    try {
      const parsed = JSON.parse(o.output);
      if (typeof parsed === 'object' && parsed !== null) {
        Object.assign(merged, parsed);
      } else {
        merged[o.stepId] = parsed;
      }
    } catch {
      merged[o.stepId] = o.output;
    }
  }
  return JSON.stringify(merged, null, 2);
}

function aggregateDedupeLines(outputs: StepOutput[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const o of outputs) {
    for (const line of o.output.split('\n')) {
      if (!seen.has(line)) {
        seen.add(line);
        lines.push(line);
      }
    }
  }
  return lines.join('\n');
}
