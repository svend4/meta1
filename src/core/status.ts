import { existsSync } from 'node:fs';
import type { RunSummary, RunStatus } from '../types/run-summary.js';
import { listRunSummaries } from '../storage/runs.js';
import { computeRunStats } from '../storage/query.js';
import type { RunStats } from '../storage/query.js';
import { findConfigFile } from './config.js';
import { getCacheStats } from './plan-cache.js';
import { getStepCacheStats } from './step-cache.js';
import { getBaseDir } from './paths.js';

/** System status overview */
export interface SystemStatus {
  /** Whether .continuumrc.json exists */
  configFound: boolean;
  /** Storage directory path */
  storageDir: string;
  /** Whether storage directory exists */
  storageExists: boolean;
  /** Plan cache statistics */
  planCache: { entries: number; totalBytes: number };
  /** Step cache statistics */
  stepCache: { entries: number; totalBytes: number };
  /** Recent run statistics (last 30 days) */
  recentStats: RunStats;
  /** Last 5 runs */
  recentRuns: RecentRun[];
  /** Health score: 0-100 */
  healthScore: number;
}

/** Summary of a recent run for display */
export interface RecentRun {
  run_id: string;
  status: RunStatus;
  prompt: string;
  started_at: string;
  duration_ms?: number;
  steps_total: number;
  steps_passed: number;
}

/**
 * Get a comprehensive system status overview.
 */
export function getSystemStatus(): SystemStatus {
  const storageDir = getBaseDir();
  const storageExists = existsSync(storageDir);
  const configFound = findConfigFile() !== null;

  // Plan cache stats
  let planCache = { entries: 0, totalBytes: 0 };
  try {
    const stats = getCacheStats();
    planCache = { entries: stats.entries, totalBytes: stats.totalBytes };
  } catch { /* empty */ }

  // Step cache stats
  let stepCache = { entries: 0, totalBytes: 0 };
  try {
    stepCache = getStepCacheStats();
  } catch { /* empty */ }

  // Recent runs (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let allRuns: RunSummary[] = [];
  try {
    allRuns = listRunSummaries();
  } catch { /* empty */ }

  const recentRunsList = allRuns.filter((r) => r.started_at >= thirtyDaysAgo);
  const recentStats = computeRunStats(recentRunsList);

  // Last 5 runs
  const sorted = [...allRuns].sort((a, b) => b.started_at.localeCompare(a.started_at));
  const recentRuns: RecentRun[] = sorted.slice(0, 5).map((r) => ({
    run_id: r.run_id,
    status: r.status,
    prompt: r.prompt.length > 80 ? r.prompt.slice(0, 77) + '...' : r.prompt,
    started_at: r.started_at,
    duration_ms: r.duration_ms,
    steps_total: r.steps.length,
    steps_passed: r.steps.filter((s) => s.status === 'completed').length,
  }));

  // Health score
  const healthScore = computeHealthScore({
    configFound,
    storageExists,
    recentStats,
    planCacheEntries: planCache.entries,
  });

  return {
    configFound,
    storageDir,
    storageExists,
    planCache,
    stepCache,
    recentStats,
    recentRuns,
    healthScore,
  };
}

function computeHealthScore(params: {
  configFound: boolean;
  storageExists: boolean;
  recentStats: RunStats;
  planCacheEntries: number;
}): number {
  let score = 100;

  // Deductions
  if (!params.configFound) score -= 15;
  if (!params.storageExists) score -= 10;

  // Failure rate penalty
  const { totalRuns, byStatus } = params.recentStats;
  if (totalRuns > 0) {
    const failures = (byStatus['failed'] ?? 0) + (byStatus['assertion_failed'] ?? 0);
    const failRate = failures / totalRuns;
    score -= Math.round(failRate * 40);
  }

  // No recent activity
  if (totalRuns === 0) score -= 10;

  // Cache health
  if (params.planCacheEntries === 0 && totalRuns > 3) score -= 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Format system status as a human-readable string.
 */
export function formatStatus(status: SystemStatus): string {
  const lines: string[] = [];

  lines.push(`Continuum Status (health: ${status.healthScore}/100)`);
  lines.push('');

  // Config
  lines.push(`  Config: ${status.configFound ? 'found' : 'not found'}`);
  lines.push(`  Storage: ${status.storageDir} (${status.storageExists ? 'exists' : 'not initialized'})`);
  lines.push(`  Plan cache: ${status.planCache.entries} entries`);
  lines.push(`  Step cache: ${status.stepCache.entries} entries`);
  lines.push('');

  // Recent stats
  const s = status.recentStats;
  lines.push(`  Last 30 days: ${s.totalRuns} runs`);
  if (s.totalRuns > 0) {
    const statusParts = Object.entries(s.byStatus)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ');
    lines.push(`    Status: ${statusParts}`);
    lines.push(`    Avg duration: ${s.avgDurationMs}ms`);
    if (s.totalTokensInput > 0) {
      lines.push(`    Tokens: ${s.totalTokensInput} in / ${s.totalTokensOutput} out`);
      lines.push(`    Est. cost: $${s.totalCostUsd.toFixed(4)}`);
    }
  }

  // Recent runs
  if (status.recentRuns.length > 0) {
    lines.push('');
    lines.push('  Recent runs:');
    for (const r of status.recentRuns) {
      const dur = r.duration_ms ? `${r.duration_ms}ms` : '?';
      lines.push(`    [${r.status}] ${r.prompt} (${dur}, ${r.steps_passed}/${r.steps_total} steps)`);
    }
  }

  return lines.join('\n');
}
