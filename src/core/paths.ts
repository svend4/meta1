import { join } from 'node:path';
import { homedir } from 'node:os';

/** Root storage directory: ~/.continuum */
export function getBaseDir(): string {
  return join(homedir(), '.continuum');
}

/** Runs directory: ~/.continuum/runs */
export function getRunsDir(): string {
  return join(getBaseDir(), 'runs');
}

/** Single run directory: ~/.continuum/runs/<run_id> */
export function getRunDir(runId: string): string {
  return join(getRunsDir(), runId);
}

/** Event log path: ~/.continuum/runs/<run_id>/events.jsonl */
export function getEventsPath(runId: string): string {
  return join(getRunDir(runId), 'events.jsonl');
}

/** Run summary path: ~/.continuum/runs/<run_id>/summary.json */
export function getSummaryPath(runId: string): string {
  return join(getRunDir(runId), 'summary.json');
}

/** Plan cache directory: ~/.continuum/cache/plans */
export function getPlanCacheDir(): string {
  return join(getBaseDir(), 'cache', 'plans');
}

/** Cached plan path: ~/.continuum/cache/plans/<cache_key>.json */
export function getCachedPlanPath(cacheKey: string): string {
  // cacheKey is "sha256:abc...", use just the hex part for filename
  const hex = cacheKey.replace('sha256:', '');
  return join(getPlanCacheDir(), `${hex}.json`);
}

/** Default workspace for a run: ~/.continuum/workspaces/<run_id> */
export function getDefaultWorkspace(runId: string): string {
  return join(getBaseDir(), 'workspaces', runId);
}

// ── v3.0 Storage Paths ──

/** Generations directory: ~/.continuum/generations */
export function getGenerationsDir(): string {
  return join(getBaseDir(), 'generations');
}

/** Generation directory: ~/.continuum/generations/<plan_hash_hex> */
export function getGenerationDir(planHash: string): string {
  const hex = planHash.replace('sha256:', '');
  return join(getGenerationsDir(), hex);
}

/** Freeze directory: ~/.continuum/freeze */
export function getFreezeDir(): string {
  return join(getBaseDir(), 'freeze');
}

/** Repairs directory: ~/.continuum/repairs */
export function getRepairsDir(): string {
  return join(getBaseDir(), 'repairs');
}

/** Repair directory: ~/.continuum/repairs/<repair_id> */
export function getRepairDir(repairId: string): string {
  return join(getRepairsDir(), repairId);
}

/** Forensics directory: ~/.continuum/runs/<run_id>/forensics */
export function getForensicsDir(runId: string): string {
  return join(getRunDir(runId), 'forensics');
}

/** HTTP forensics directory: ~/.continuum/runs/<run_id>/forensics/http/<step_id> */
export function getHttpForensicsDir(runId: string, stepId: string): string {
  return join(getForensicsDir(runId), 'http', stepId);
}
