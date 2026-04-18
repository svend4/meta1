import type { RunSummary } from '../types/run-summary.js';
import { loadRunSummary, listRunSummaries } from '../storage/runs.js';

/** Supported export formats */
export type ExportFormat = 'html' | 'csv' | 'markdown';

/** Export options */
export interface ExportOptions {
  /** Run IDs to export. If empty, exports all. */
  runIds?: string[];
  /** Filter by status */
  status?: string;
  /** Only runs after this date */
  since?: string;
  /** Only runs before this date */
  until?: string;
  /** Include step details */
  includeSteps?: boolean;
}

/**
 * Export runs in the specified format.
 */
export function exportRuns(format: ExportFormat, options?: ExportOptions): string {
  let runs = getRuns(options);

  switch (format) {
    case 'html': return exportHtml(runs, options?.includeSteps ?? true);
    case 'csv': return exportCsv(runs);
    case 'markdown': return exportMarkdown(runs, options?.includeSteps ?? true);
  }
}

function getRuns(options?: ExportOptions): RunSummary[] {
  let runs: RunSummary[];

  if (options?.runIds && options.runIds.length > 0) {
    runs = options.runIds.map((id) => loadRunSummary(id));
  } else {
    runs = listRunSummaries();
  }

  if (options?.status) {
    runs = runs.filter((r) => r.status === options.status);
  }
  if (options?.since) {
    runs = runs.filter((r) => r.started_at >= options.since!);
  }
  if (options?.until) {
    runs = runs.filter((r) => r.started_at <= options.until!);
  }

  return runs;
}

// ── HTML Export ──

function exportHtml(runs: RunSummary[], includeSteps: boolean): string {
  const rows = runs.map((r) => {
    const statusClass = r.status === 'completed' || r.status === 'verified' ? 'success' : r.status === 'failed' ? 'failure' : 'other';
    const stepRows = includeSteps ? r.steps.map((s) =>
      `<tr class="step"><td></td><td>${esc(s.step_id)}</td><td>${s.type}</td><td class="${s.status}">${s.status}</td><td>${s.duration_ms ?? '-'}ms</td><td>${esc(s.error ?? '')}</td></tr>`
    ).join('\n') : '';

    return `<tr class="run ${statusClass}">
  <td>${esc(r.run_id.slice(0, 8))}</td>
  <td>${esc(r.task_id)}</td>
  <td>${esc(r.status)}</td>
  <td>${r.duration_ms ?? '-'}ms</td>
  <td>${r.started_at.slice(0, 19)}</td>
  <td>${r.steps.length} steps</td>
</tr>
${stepRows}`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Continuum Runtime Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 2rem; background: #fafafa; }
  h1 { color: #1a1a2e; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
  th { background: #1a1a2e; color: white; }
  .success td:nth-child(3) { color: #27ae60; font-weight: bold; }
  .failure td:nth-child(3) { color: #e74c3c; font-weight: bold; }
  .step td { font-size: 0.85em; color: #666; padding-left: 2rem; }
  .step .completed { color: #27ae60; }
  .step .failed { color: #e74c3c; }
  .step .skipped { color: #95a5a6; }
  .meta { color: #666; margin-top: 0.5rem; }
</style>
</head>
<body>
<h1>Continuum Runtime Report</h1>
<p class="meta">Generated: ${new Date().toISOString()} | Runs: ${runs.length}</p>
<table>
<thead><tr><th>Run ID</th><th>Task</th><th>Status</th><th>Duration</th><th>Started</th><th>Steps</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>`;
}

// ── CSV Export ──

function exportCsv(runs: RunSummary[]): string {
  const header = 'run_id,task_id,status,duration_ms,started_at,completed_at,plan_source,plan_hash,steps_total,steps_failed,steps_skipped,input_tokens,output_tokens,estimated_cost_usd';
  const rows = runs.map((r) => {
    const failed = r.steps.filter((s) => s.status === 'failed').length;
    const skipped = r.steps.filter((s) => s.status === 'skipped').length;
    return [
      csvEsc(r.run_id),
      csvEsc(r.task_id),
      r.status,
      r.duration_ms ?? '',
      r.started_at,
      r.completed_at ?? '',
      r.plan_source,
      r.plan_hash,
      r.steps.length,
      failed,
      skipped,
      r.token_usage?.input_tokens ?? '',
      r.token_usage?.output_tokens ?? '',
      r.token_usage?.estimated_cost_usd ?? '',
    ].join(',');
  });

  return [header, ...rows].join('\n');
}

// ── Markdown Export ──

function exportMarkdown(runs: RunSummary[], includeSteps: boolean): string {
  const lines: string[] = [];
  lines.push('# Continuum Runtime Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()} | Runs: ${runs.length}`);
  lines.push('');
  lines.push('| Run ID | Task | Status | Duration | Started |');
  lines.push('|--------|------|--------|----------|---------|');

  for (const r of runs) {
    const dur = r.duration_ms !== undefined ? `${r.duration_ms}ms` : '-';
    lines.push(`| \`${r.run_id.slice(0, 8)}\` | ${r.task_id} | **${r.status}** | ${dur} | ${r.started_at.slice(0, 19)} |`);
  }

  if (includeSteps) {
    lines.push('');
    lines.push('## Step Details');
    lines.push('');

    for (const r of runs) {
      lines.push(`### Run \`${r.run_id.slice(0, 8)}\``);
      lines.push('');
      lines.push('| Step | Type | Status | Duration | Error |');
      lines.push('|------|------|--------|----------|-------|');

      for (const s of r.steps) {
        const dur = s.duration_ms !== undefined ? `${s.duration_ms}ms` : '-';
        lines.push(`| ${s.step_id} | ${s.type} | ${s.status} | ${dur} | ${s.error ?? ''} |`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function csvEsc(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
