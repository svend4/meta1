import { rmSync, existsSync } from 'node:fs';
import { getRunDir } from './paths.js';
import { listRunSummaries } from '../storage/runs.js';
import { clearExpired } from './plan-cache.js';

export interface CleanupTarget {
  type: 'run' | 'cache';
  id: string;
  age_days: number;
  path: string;
}

export interface CleanupResult {
  removed: CleanupTarget[];
  kept: number;
  errors: Array<{ id: string; error: string }>;
}

export interface CleanupOptions {
  maxRuns?: number;
  maxAgeDays?: number;
  dryRun?: boolean;
  includeCache?: boolean;
}

/**
 * Find runs that should be cleaned up based on retention policy.
 */
export function findCleanupTargets(options: {
  maxRuns?: number;
  maxAgeDays?: number;
}): CleanupTarget[] {
  const targets: CleanupTarget[] = [];
  const now = Date.now();
  const targetIds = new Set<string>();

  const summaries = listRunSummaries();

  // Mark by age
  if (options.maxAgeDays !== undefined) {
    const maxAgeMs = options.maxAgeDays * 24 * 60 * 60 * 1000;
    for (const summary of summaries) {
      const ageMs = now - new Date(summary.started_at).getTime();
      if (ageMs > maxAgeMs && !targetIds.has(summary.run_id)) {
        targetIds.add(summary.run_id);
        targets.push({
          type: 'run',
          id: summary.run_id,
          age_days: Math.round(ageMs / (24 * 60 * 60 * 1000) * 10) / 10,
          path: getRunDir(summary.run_id),
        });
      }
    }
  }

  // Mark by count (keep newest N, remove oldest)
  if (options.maxRuns !== undefined && summaries.length > options.maxRuns) {
    // Summaries sorted oldest-first by listRunSummaries()
    const sortedNewestFirst = [...summaries].reverse();
    const excess = sortedNewestFirst.slice(options.maxRuns);

    for (const summary of excess) {
      if (targetIds.has(summary.run_id)) continue;
      targetIds.add(summary.run_id);
      const ageMs = now - new Date(summary.started_at).getTime();
      targets.push({
        type: 'run',
        id: summary.run_id,
        age_days: Math.round(ageMs / (24 * 60 * 60 * 1000) * 10) / 10,
        path: getRunDir(summary.run_id),
      });
    }
  }

  return targets;
}

/**
 * Execute cleanup by removing target directories.
 */
export function executeCleanup(targets: CleanupTarget[]): CleanupResult {
  const removed: CleanupTarget[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (const target of targets) {
    try {
      if (existsSync(target.path)) {
        rmSync(target.path, { recursive: true, force: true });
      }
      removed.push(target);
    } catch (err: unknown) {
      errors.push({
        id: target.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { removed, kept: 0, errors };
}

/**
 * Full cleanup pipeline: find targets, optionally execute.
 */
export function cleanup(options: CleanupOptions): {
  targets: CleanupTarget[];
  result?: CleanupResult;
  cacheCleared?: number;
} {
  const targets = findCleanupTargets({
    maxRuns: options.maxRuns,
    maxAgeDays: options.maxAgeDays,
  });

  let cacheCleared: number | undefined;
  if (options.includeCache) {
    cacheCleared = clearExpired();
  }

  if (options.dryRun) {
    return { targets, cacheCleared };
  }

  const result = executeCleanup(targets);
  return { targets, result, cacheCleared };
}
