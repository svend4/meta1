import type { RunSummary } from '../types/run-summary.js';
import { listRunSummaries } from '../storage/runs.js';

/** A search result with match context */
export interface SearchResult {
  run_id: string;
  status: string;
  started_at: string;
  prompt: string;
  matchField: string;
  matchContext: string;
}

/** Search options */
export interface SearchOptions {
  /** Search query text */
  query: string;
  /** Fields to search. Default: all. */
  fields?: Array<'prompt' | 'error' | 'stdout' | 'stderr' | 'step_id' | 'description'>;
  /** Maximum results. Default: 20. */
  limit?: number;
  /** Case sensitive search. Default: false. */
  caseSensitive?: boolean;
}

/**
 * Search across all runs for matching text.
 * Searches prompt, step errors, step output, and descriptions.
 */
export function searchRuns(options: SearchOptions): SearchResult[] {
  const runs = listRunSummaries();
  const results: SearchResult[] = [];
  const limit = options.limit ?? 20;
  const fields = options.fields ?? ['prompt', 'error', 'stdout', 'stderr', 'step_id', 'description'];
  const needle = options.caseSensitive ? options.query : options.query.toLowerCase();

  for (const run of runs) {
    if (results.length >= limit) break;

    const matches = searchInRun(run, needle, fields, options.caseSensitive ?? false);
    results.push(...matches);
  }

  return results.slice(0, limit);
}

function searchInRun(
  run: RunSummary,
  needle: string,
  fields: string[],
  caseSensitive: boolean,
): SearchResult[] {
  const results: SearchResult[] = [];
  const match = (text: string) =>
    caseSensitive ? text.includes(needle) : text.toLowerCase().includes(needle);

  const context = (text: string) => {
    const idx = caseSensitive ? text.indexOf(needle) : text.toLowerCase().indexOf(needle);
    if (idx === -1) return text.slice(0, 80);
    const start = Math.max(0, idx - 30);
    const end = Math.min(text.length, idx + needle.length + 30);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    return prefix + text.slice(start, end) + suffix;
  };

  // Search prompt
  if (fields.includes('prompt') && match(run.prompt)) {
    results.push({
      run_id: run.run_id,
      status: run.status,
      started_at: run.started_at,
      prompt: run.prompt,
      matchField: 'prompt',
      matchContext: context(run.prompt),
    });
  }

  // Search steps
  for (const step of run.steps) {
    if (fields.includes('error') && step.error && match(step.error)) {
      results.push({
        run_id: run.run_id,
        status: run.status,
        started_at: run.started_at,
        prompt: run.prompt,
        matchField: `step:${step.step_id}:error`,
        matchContext: context(step.error),
      });
    }

    if (fields.includes('stdout') && step.stdout && match(step.stdout)) {
      results.push({
        run_id: run.run_id,
        status: run.status,
        started_at: run.started_at,
        prompt: run.prompt,
        matchField: `step:${step.step_id}:stdout`,
        matchContext: context(step.stdout),
      });
    }

    if (fields.includes('stderr') && step.stderr && match(step.stderr)) {
      results.push({
        run_id: run.run_id,
        status: run.status,
        started_at: run.started_at,
        prompt: run.prompt,
        matchField: `step:${step.step_id}:stderr`,
        matchContext: context(step.stderr),
      });
    }

    if (fields.includes('step_id') && match(step.step_id)) {
      results.push({
        run_id: run.run_id,
        status: run.status,
        started_at: run.started_at,
        prompt: run.prompt,
        matchField: `step:${step.step_id}:id`,
        matchContext: step.step_id,
      });
    }

    if (fields.includes('description') && step.description && match(step.description)) {
      results.push({
        run_id: run.run_id,
        status: run.status,
        started_at: run.started_at,
        prompt: run.prompt,
        matchField: `step:${step.step_id}:description`,
        matchContext: context(step.description),
      });
    }
  }

  return results;
}
