import type { RunSummary } from '../types/run-summary.js';

/** A step's position on the timeline */
export interface TimelineEntry {
  step_id: string;
  type: string;
  status: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

/** Full timeline for a run */
export interface RunTimeline {
  run_id: string;
  totalDurationMs: number;
  entries: TimelineEntry[];
}

/**
 * Build a timeline from run events.
 * Uses step durations and ordering to reconstruct timing.
 * For sequential runs, steps are stacked end-to-end.
 * For parallel runs, completed steps may overlap.
 */
export function buildTimeline(run: RunSummary): RunTimeline {
  const entries: TimelineEntry[] = [];
  let cursor = 0;

  if (run.plan.execution_mode === 'parallel') {
    // Reconstruct parallel timeline from step dependencies
    const depsMap = new Map(run.plan.steps.map((s) => [s.step_id, s.depends_on ?? []]));
    const startTimes = new Map<string, number>();

    for (const step of run.steps) {
      const deps = depsMap.get(step.step_id) ?? [];
      // Start time is max end time of all dependencies
      let startMs = 0;
      for (const dep of deps) {
        const depEntry = entries.find((e) => e.step_id === dep);
        if (depEntry) {
          startMs = Math.max(startMs, depEntry.endMs);
        }
      }

      const durationMs = step.duration_ms ?? 0;
      entries.push({
        step_id: step.step_id,
        type: step.type,
        status: step.status,
        startMs,
        endMs: startMs + durationMs,
        durationMs,
      });
      startTimes.set(step.step_id, startMs);
    }
  } else {
    // Sequential: stack end-to-end
    for (const step of run.steps) {
      const durationMs = step.duration_ms ?? 0;
      entries.push({
        step_id: step.step_id,
        type: step.type,
        status: step.status,
        startMs: cursor,
        endMs: cursor + durationMs,
        durationMs,
      });
      cursor += durationMs;
    }
  }

  const totalDurationMs = entries.length > 0
    ? Math.max(...entries.map((e) => e.endMs))
    : 0;

  return { run_id: run.run_id, totalDurationMs, entries };
}

/**
 * Render a timeline as an ASCII Gantt chart.
 */
export function formatTimeline(timeline: RunTimeline, width = 60): string {
  const lines: string[] = [];
  const total = timeline.totalDurationMs || 1;

  // Header
  lines.push(`Timeline: ${timeline.run_id.slice(0, 8)}  (${formatMs(timeline.totalDurationMs)} total)`);
  lines.push('');

  // Find max step ID length for alignment
  const maxIdLen = Math.max(10, ...timeline.entries.map((e) => e.step_id.length));

  // Render each step
  for (const entry of timeline.entries) {
    const id = entry.step_id.padEnd(maxIdLen);
    const startCol = Math.floor((entry.startMs / total) * width);
    const endCol = Math.max(startCol + 1, Math.floor((entry.endMs / total) * width));
    const barLen = endCol - startCol;

    const char = statusChar(entry.status);
    const prefix = ' '.repeat(startCol);
    const bar = char.repeat(barLen);

    lines.push(`  ${id} |${prefix}${bar}| ${formatMs(entry.durationMs)}`);
  }

  // Time axis
  lines.push(`  ${''.padEnd(maxIdLen)} |${'─'.repeat(width)}|`);

  // Time labels
  const startLabel = '0';
  const midLabel = formatMs(Math.round(total / 2));
  const endLabel = formatMs(total);
  const axis = startLabel
    + ' '.repeat(Math.max(1, Math.floor(width / 2) - startLabel.length - Math.floor(midLabel.length / 2)))
    + midLabel
    + ' '.repeat(Math.max(1, width - Math.floor(width / 2) - Math.ceil(midLabel.length / 2) - endLabel.length))
    + endLabel;
  lines.push(`  ${''.padEnd(maxIdLen)}  ${axis}`);

  // Legend
  lines.push('');
  lines.push(`  Legend: ${'█'} completed  ${'▒'} skipped  ${'░'} failed`);

  return lines.join('\n');
}

function statusChar(status: string): string {
  switch (status) {
    case 'completed': return '█';
    case 'skipped': return '▒';
    case 'failed': return '░';
    default: return '▓';
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
