import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { lookupPlan, storePlan, clearCache } from '../src/core/plan-cache.js';
import { computeCacheKey, hashObject } from '../src/core/hasher.js';
import type { ExecutionPlan } from '../src/types/execution-plan.js';
import * as paths from '../src/core/paths.js';
import { vi } from 'vitest';

// Redirect cache dir to temp for tests
const testDir = join(tmpdir(), `continuum-cache-test-${randomUUID()}`);

vi.spyOn(paths, 'getPlanCacheDir').mockReturnValue(join(testDir, 'cache', 'plans'));
vi.spyOn(paths, 'getCachedPlanPath').mockImplementation((cacheKey: string) => {
  const hex = cacheKey.replace('sha256:', '');
  return join(testDir, 'cache', 'plans', `${hex}.json`);
});

function makePlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    plan_id: randomUUID(),
    steps: [
      {
        step_id: 'step-1',
        type: 'create_file',
        description: 'Create index.js',
        path: 'index.js',
        content: 'console.log("hello");',
        determinism: 'guaranteed',
      },
    ],
    ...overrides,
  };
}

const baseParams = {
  prompt: 'Build an Express API',
  model: 'claude-sonnet-4-20250514',
  systemPromptHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `sha256:${string}`,
};

describe('plan-cache', () => {
  beforeEach(() => {
    mkdirSync(join(testDir, 'cache', 'plans'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns cache miss when no cached plan exists', () => {
    const result = lookupPlan(baseParams);
    expect(result.hit).toBe(false);
    if (!result.hit) {
      expect(result.reason).toBe('not_found');
      expect(result.cacheKey).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it('stores and retrieves a plan from cache', () => {
    const plan = makePlan();
    const cacheKey = storePlan(plan, baseParams);

    const result = lookupPlan(baseParams);
    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.plan.plan_id).toBe(plan.plan_id);
      expect(result.plan.steps).toHaveLength(1);
      expect(result.cacheKey).toBe(cacheKey);
      expect(result.planHash).toBe(hashObject(plan));
    }
  });

  it('same prompt + context → same cache key', () => {
    const key1 = computeCacheKey(baseParams);
    const key2 = computeCacheKey(baseParams);
    expect(key1).toBe(key2);
  });

  it('different prompt → different cache key', () => {
    const key1 = computeCacheKey(baseParams);
    const key2 = computeCacheKey({ ...baseParams, prompt: 'Build a React app' });
    expect(key1).not.toBe(key2);
  });

  it('different model → different cache key', () => {
    const key1 = computeCacheKey(baseParams);
    const key2 = computeCacheKey({ ...baseParams, model: 'claude-opus-4-20250514' });
    expect(key1).not.toBe(key2);
  });

  it('different system prompt hash → different cache key', () => {
    const key1 = computeCacheKey(baseParams);
    const key2 = computeCacheKey({
      ...baseParams,
      systemPromptHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `sha256:${string}`,
    });
    expect(key1).not.toBe(key2);
  });

  it('different context → different cache key', () => {
    const key1 = computeCacheKey({ ...baseParams, context: { version: '1.0' } });
    const key2 = computeCacheKey({ ...baseParams, context: { version: '2.0' } });
    expect(key1).not.toBe(key2);
  });

  it('cache hit → no LLM call needed (plan loaded from disk)', () => {
    const plan = makePlan();
    storePlan(plan, baseParams);

    // Simulate what runner would do: lookup first
    const result = lookupPlan(baseParams);
    expect(result.hit).toBe(true);
    // If hit, runner skips LLM — we just verify the plan is usable
    if (result.hit) {
      expect(result.plan.steps.length).toBeGreaterThan(0);
    }
  });

  it('cached plan still passes schema validation on load', () => {
    const plan = makePlan({
      description: 'A test plan',
      planner_signature: {
        planner_model: 'claude-sonnet-4-20250514',
        system_prompt_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        generated_at: new Date().toISOString(),
      },
    });
    storePlan(plan, baseParams);

    // lookupPlan calls assertValidPlan internally
    const result = lookupPlan(baseParams);
    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.plan.planner_signature?.planner_model).toBe('claude-sonnet-4-20250514');
    }
  });

  it('clearCache removes all cached plans', () => {
    const plan1 = makePlan();
    const plan2 = makePlan();
    storePlan(plan1, baseParams);
    storePlan(plan2, { ...baseParams, prompt: 'different prompt' });

    const count = clearCache();
    expect(count).toBe(2);

    // Both should be gone
    const result = lookupPlan(baseParams);
    expect(result.hit).toBe(false);
  });

  it('clearCache on empty cache returns 0', () => {
    const count = clearCache();
    expect(count).toBe(0);
  });
});
