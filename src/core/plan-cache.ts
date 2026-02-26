import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
  reason: 'not_found' | 'expired';
}

export type CacheLookupResult = CacheHit | CacheMiss;

/** Default cache TTL: 7 days in milliseconds */
export const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Look up a cached execution plan by task parameters.
 * Returns the cached plan if found and not expired, or a cache miss.
 * Set ttlMs to 0 or Infinity to disable TTL.
 */
export function lookupPlan(params: {
  prompt: string;
  context?: Record<string, unknown>;
  model: string;
  systemPromptHash: `sha256:${string}`;
}, ttlMs?: number): CacheLookupResult {
  const cacheKey = computeCacheKey(params);
  const path = getCachedPlanPath(cacheKey);

  if (!existsSync(path)) {
    return { hit: false, cacheKey, reason: 'not_found' };
  }

  // Check TTL if specified
  const effectiveTtl = ttlMs ?? 0; // 0 = no TTL by default (backward compat)
  if (effectiveTtl > 0 && effectiveTtl !== Infinity) {
    const stat = statSync(path);
    const age = Date.now() - stat.mtimeMs;
    if (age > effectiveTtl) {
      return { hit: false, cacheKey, reason: 'expired' };
    }
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

/**
 * Clear cached plans older than a given TTL.
 * Returns the number of expired files removed.
 */
export function clearExpired(ttlMs: number = DEFAULT_CACHE_TTL_MS): number {
  const dir = getPlanCacheDir();
  if (!existsSync(dir)) return 0;

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const now = Date.now();
  let removed = 0;

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (now - stat.mtimeMs > ttlMs) {
      unlinkSync(filePath);
      removed++;
    }
  }

  return removed;
}

/**
 * Get cache statistics: total entries, oldest entry age, total size.
 */
export function getCacheStats(): {
  entries: number;
  oldestAgeMs: number;
  totalBytes: number;
} {
  const dir = getPlanCacheDir();
  if (!existsSync(dir)) return { entries: 0, oldestAgeMs: 0, totalBytes: 0 };

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const now = Date.now();
  let oldestAgeMs = 0;
  let totalBytes = 0;

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    const age = now - stat.mtimeMs;
    if (age > oldestAgeMs) oldestAgeMs = age;
    totalBytes += stat.size;
  }

  return { entries: files.length, oldestAgeMs, totalBytes };
}
