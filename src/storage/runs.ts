import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
} from 'node:fs';
import type { RunSummary } from '../types/run-summary.js';
import { getRunsDir, getRunDir, getSummaryPath } from '../core/paths.js';

/** Save a run summary to disk */
export function saveRunSummary(summary: RunSummary): void {
  const dir = getRunDir(summary.run_id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(getSummaryPath(summary.run_id), JSON.stringify(summary, null, 2), 'utf8');
}

/** Load a run summary from disk */
export function loadRunSummary(runId: string): RunSummary {
  const path = getSummaryPath(runId);
  if (!existsSync(path)) {
    throw new Error(`Run summary not found: ${runId}`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as RunSummary;
}

/** List all run IDs (directory names in ~/.continuum/runs/) */
export function listRunIds(): string[] {
  const dir = getRunsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** List all run summaries (sorted by start time) */
export function listRunSummaries(): RunSummary[] {
  return listRunIds()
    .map((id) => {
      try {
        return loadRunSummary(id);
      } catch {
        return null;
      }
    })
    .filter((s): s is RunSummary => s !== null)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
}

/** Check if a run exists */
export function runExists(runId: string): boolean {
  return existsSync(getSummaryPath(runId));
}
