import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExecutionPlan } from '../types/execution-plan.js';
import { computeCacheKey, hashObject } from './hasher.js';
import { getPlanCacheDir, getCachedPlanPath } from './paths.js';
import { assertValidPlan } from './validator.js';

export interface CacheHit {
  hit: true;
  plan: ExecutionPlan;
  cacheKey: `sha256:${string}`;
  planHash: `sha256:${string}`;
}

export interface CacheMiss {
  hit: false;
  cacheKey: `sha256:${string}`;
  reason: 'not_found';
}

export type CacheLookupResult = CacheHit | CacheMiss;

/**
 * Look up a cached execution plan by task parameters.
 * Returns the cached plan if found, or a cache miss with the computed key.
 */
export function lookupPlan(params: {
  prompt: string;
  context?: Record<string, unknown>;
  model: string;
  systemPromptHash: `sha256:${string}`;
}): CacheLookupResult {
  const cacheKey = computeCacheKey(params);
  const path = getCachedPlanPath(cacheKey);

  if (!existsSync(path)) {
    return { hit: false, cacheKey, reason: 'not_found' };
  }

  const raw = JSON.parse(readFileSync(path, 'utf8'));
  assertValidPlan(raw);
  const plan = raw as ExecutionPlan;
  const planHash = hashObject(plan);

  return { hit: true, plan, cacheKey, planHash };
}

/**
 * Store an execution plan in the cache.
 * Returns the cache key used for storage.
 */
export function storePlan(
  plan: ExecutionPlan,
  params: {
    prompt: string;
    context?: Record<string, unknown>;
    model: string;
    systemPromptHash: `sha256:${string}`;
  },
): `sha256:${string}` {
  const cacheKey = computeCacheKey(params);
  const path = getCachedPlanPath(cacheKey);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(plan, null, 2), 'utf8');
  return cacheKey;
}

/**
 * Clear all cached plans.
 * Returns the number of files removed.
 */
export function clearCache(): number {
  const dir = getPlanCacheDir();
  if (!existsSync(dir)) return 0;

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const count = files.length;

  if (count > 0) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }

  return count;
}
