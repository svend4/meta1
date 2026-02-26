import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  createOriginalLineage,
  createBenignDriftGeneration,
  createDeterministicRepairGeneration,
  createLLMRepairGeneration,
  saveGeneration,
  loadLineage,
  loadGenerationPlan,
  getLineageChain,
} from '../../src/core/lineage.js';
import { hashObject } from '../../src/core/hasher.js';
import type { ExecutionPlan, PlannerSignature } from '../../src/types/execution-plan.js';
import type { AppliedMutation } from '../../src/types/plan-lineage.js';
import * as paths from '../../src/core/paths.js';

let tempDir: string;

function makePlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    plan_id: randomUUID(),
    description: 'Test plan',
    steps: [{
      step_id: 'step-1',
      type: 'create_file',
      description: 'Create file',
      path: 'test.txt',
      content: 'hello',
      determinism: 'guaranteed',
    }],
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-lineage-test-'));
  vi.spyOn(paths, 'getBaseDir').mockReturnValue(tempDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('createOriginalLineage', () => {
  it('creates generation 0 with mutation_type original', () => {
    const lineage = createOriginalLineage();
    expect(lineage.generation).toBe(0);
    expect(lineage.mutation_type).toBe('original');
    expect(lineage.parent_plan_hash).toBeUndefined();
  });
});

describe('createBenignDriftGeneration', () => {
  it('creates lineage with benign drift context', () => {
    const parentHash = 'sha256:' + 'a'.repeat(64) as `sha256:${string}`;
    const artifacts = [
      { path: 'output.js', old_hash: 'sha256:old' as `sha256:${string}`, new_hash: 'sha256:new' as `sha256:${string}` },
    ];

    const lineage = createBenignDriftGeneration(parentHash, 0, artifacts);

    expect(lineage.generation).toBe(1);
    expect(lineage.mutation_type).toBe('benign_drift_accepted');
    expect(lineage.parent_plan_hash).toBe(parentHash);
    expect(lineage.benign_drift_context).toBeDefined();
    expect(lineage.benign_drift_context!.changed_artifacts).toHaveLength(1);
    expect(lineage.benign_drift_context!.assertions_verified).toBe(true);
    expect(lineage.mutation_reason).toContain('1 artifact(s) changed');
  });

  it('increments generation from parent', () => {
    const parentHash = 'sha256:' + 'b'.repeat(64) as `sha256:${string}`;
    const lineage = createBenignDriftGeneration(parentHash, 5, []);
    expect(lineage.generation).toBe(6);
  });
});

describe('createDeterministicRepairGeneration', () => {
  it('creates lineage with repair strategy info', () => {
    const parentHash = 'sha256:' + 'c'.repeat(64) as `sha256:${string}`;
    const lineage = createDeterministicRepairGeneration(
      parentHash, 2, 'npm-clean-install', ['drift-1', 'drift-2'],
    );

    expect(lineage.generation).toBe(3);
    expect(lineage.mutation_type).toBe('repair_deterministic');
    expect(lineage.parent_plan_hash).toBe(parentHash);
    expect(lineage.deterministic_repair).toBeDefined();
    expect(lineage.deterministic_repair!.strategy_id).toBe('npm-clean-install');
    expect(lineage.deterministic_repair!.drift_vectors).toEqual(['drift-1', 'drift-2']);
  });
});

describe('createLLMRepairGeneration', () => {
  it('creates lineage with full repair context', () => {
    const parentHash = 'sha256:' + 'd'.repeat(64) as `sha256:${string}`;
    const promptHash = 'sha256:' + 'e'.repeat(64) as `sha256:${string}`;
    const sig: PlannerSignature = {
      planner_model: 'claude-sonnet-4-20250514',
      planner_version: 'claude-sonnet-4-20250514',
      system_prompt_hash: promptHash,
      generated_at: new Date().toISOString(),
    };
    const mutations: AppliedMutation[] = [{
      type: 'modify_content',
      step_id: 'step-1',
      description: 'Updated file content',
      before_hash: 'sha256:old' as `sha256:${string}`,
      after_hash: 'sha256:new' as `sha256:${string}`,
    }];

    const lineage = createLLMRepairGeneration(
      parentHash, 1, ['drift-1'], promptHash, sig, mutations,
    );

    expect(lineage.generation).toBe(2);
    expect(lineage.mutation_type).toBe('repair_llm');
    expect(lineage.parent_plan_hash).toBe(parentHash);
    expect(lineage.repair_context).toBeDefined();
    expect(lineage.repair_context!.drift_vectors).toEqual(['drift-1']);
    expect(lineage.repair_context!.mutations_applied).toHaveLength(1);
    expect(lineage.repair_context!.repair_signature).toBe(sig);
    expect(lineage.mutation_reason).toContain('1 mutation(s)');
  });
});

describe('saveGeneration', () => {
  it('saves plan and lineage to generations directory', () => {
    const plan = makePlan();
    const lineage = createOriginalLineage();

    const planHash = saveGeneration(plan, lineage);

    expect(planHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const hex = planHash.replace('sha256:', '');
    const genDir = join(tempDir, 'generations', hex);
    expect(existsSync(join(genDir, 'plan.json'))).toBe(true);
    expect(existsSync(join(genDir, 'lineage.json'))).toBe(true);
  });

  it('saves verification data when assertion results provided', () => {
    const plan = makePlan();
    const lineage = createOriginalLineage();
    const assertionResults = [{
      assertion_id: 'a1',
      type: 'file_exists' as const,
      stability: 'stable' as const,
      passed: true,
      attempts: 1,
      duration_ms: 5,
      expected: 'exists',
      actual: 'exists',
    }];

    const planHash = saveGeneration(plan, lineage, assertionResults, 'run-123');

    const hex = planHash.replace('sha256:', '');
    const verificationPath = join(tempDir, 'generations', hex, 'verification.json');
    expect(existsSync(verificationPath)).toBe(true);

    const verification = JSON.parse(readFileSync(verificationPath, 'utf8'));
    expect(verification.assertion_results).toHaveLength(1);
    expect(verification.run_id).toBe('run-123');
  });

  it('does not save verification when no assertion results', () => {
    const plan = makePlan();
    const lineage = createOriginalLineage();

    const planHash = saveGeneration(plan, lineage);

    const hex = planHash.replace('sha256:', '');
    const verificationPath = join(tempDir, 'generations', hex, 'verification.json');
    expect(existsSync(verificationPath)).toBe(false);
  });

  it('returns correct hash of plan', () => {
    const plan = makePlan();
    const lineage = createOriginalLineage();
    const expected = hashObject(plan);

    const actual = saveGeneration(plan, lineage);
    expect(actual).toBe(expected);
  });
});

describe('loadLineage', () => {
  it('loads previously saved lineage', () => {
    const plan = makePlan();
    const lineage = createOriginalLineage();
    const hash = saveGeneration(plan, lineage);

    const loaded = loadLineage(hash);
    expect(loaded).not.toBeNull();
    expect(loaded!.generation).toBe(0);
    expect(loaded!.mutation_type).toBe('original');
  });

  it('returns null for nonexistent hash', () => {
    const hash = 'sha256:' + 'f'.repeat(64) as `sha256:${string}`;
    expect(loadLineage(hash)).toBeNull();
  });
});

describe('loadGenerationPlan', () => {
  it('loads previously saved plan', () => {
    const plan = makePlan({ description: 'Unique plan for loading' });
    const lineage = createOriginalLineage();
    const hash = saveGeneration(plan, lineage);

    const loaded = loadGenerationPlan(hash);
    expect(loaded).not.toBeNull();
    expect(loaded!.description).toBe('Unique plan for loading');
  });

  it('returns null for nonexistent hash', () => {
    const hash = 'sha256:' + '0'.repeat(64) as `sha256:${string}`;
    expect(loadGenerationPlan(hash)).toBeNull();
  });
});

describe('getLineageChain', () => {
  it('returns single entry for original plan', () => {
    const plan = makePlan();
    const lineage = createOriginalLineage();
    const hash = saveGeneration(plan, lineage);

    const chain = getLineageChain(hash);
    expect(chain).toHaveLength(1);
    expect(chain[0].planHash).toBe(hash);
    expect(chain[0].lineage.generation).toBe(0);
  });

  it('returns full chain for multi-generation lineage', () => {
    // Generation 0: original
    const plan0 = makePlan({ description: 'gen 0' });
    const lineage0 = createOriginalLineage();
    const hash0 = saveGeneration(plan0, lineage0);

    // Generation 1: benign drift
    const plan1 = makePlan({ description: 'gen 1' });
    const lineage1 = createBenignDriftGeneration(hash0, 0, [
      { path: 'out.js', old_hash: 'sha256:a' as `sha256:${string}`, new_hash: 'sha256:b' as `sha256:${string}` },
    ]);
    const hash1 = saveGeneration(plan1, lineage1);

    // Generation 2: deterministic repair
    const plan2 = makePlan({ description: 'gen 2' });
    const lineage2 = createDeterministicRepairGeneration(hash1, 1, 'npm-clean-install', ['d1']);
    const hash2 = saveGeneration(plan2, lineage2);

    const chain = getLineageChain(hash2);
    expect(chain).toHaveLength(3);
    expect(chain[0].lineage.generation).toBe(0);
    expect(chain[1].lineage.generation).toBe(1);
    expect(chain[2].lineage.generation).toBe(2);
    expect(chain[0].lineage.mutation_type).toBe('original');
    expect(chain[1].lineage.mutation_type).toBe('benign_drift_accepted');
    expect(chain[2].lineage.mutation_type).toBe('repair_deterministic');
  });

  it('returns empty chain for nonexistent hash', () => {
    const hash = 'sha256:' + 'f'.repeat(64) as `sha256:${string}`;
    const chain = getLineageChain(hash);
    expect(chain).toHaveLength(0);
  });

  it('returns partial chain when ancestor is missing', () => {
    // Create gen 1 that points to nonexistent gen 0
    const plan = makePlan();
    const lineage = createBenignDriftGeneration(
      'sha256:' + '0'.repeat(64) as `sha256:${string}`, 0, [],
    );
    const hash = saveGeneration(plan, lineage);

    const chain = getLineageChain(hash);
    // Should only have the one entry since parent doesn't exist
    expect(chain).toHaveLength(1);
    expect(chain[0].lineage.generation).toBe(1);
  });
});
