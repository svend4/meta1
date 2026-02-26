import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanLineage, AppliedMutation } from '../types/plan-lineage.js';
import type { ExecutionPlan, PlannerSignature } from '../types/execution-plan.js';
import type { AssertionResult } from '../types/assertion.js';
import { hashObject } from './hasher.js';
import { getBaseDir } from './paths.js';

/** Get the generations directory */
function getGenerationsDir(): string {
  return join(getBaseDir(), 'generations');
}

/** Get directory for a specific plan generation */
function getGenerationDir(planHash: string): string {
  const hex = planHash.replace('sha256:', '');
  return join(getGenerationsDir(), hex);
}

/** Create the original (generation 0) lineage */
export function createOriginalLineage(): PlanLineage {
  return {
    mutation_type: 'original',
    generation: 0,
  };
}

/** Create a new generation for benign drift acceptance */
export function createBenignDriftGeneration(
  parentPlanHash: `sha256:${string}`,
  parentGeneration: number,
  changedArtifacts: Array<{ path: string; old_hash: `sha256:${string}`; new_hash: `sha256:${string}` }>,
): PlanLineage {
  return {
    parent_plan_hash: parentPlanHash,
    mutation_type: 'benign_drift_accepted',
    mutation_reason: `Benign drift: ${changedArtifacts.length} artifact(s) changed, all assertions passed`,
    generation: parentGeneration + 1,
    benign_drift_context: {
      changed_artifacts: changedArtifacts,
      assertions_verified: true,
    },
  };
}

/** Create a new generation for deterministic repair */
export function createDeterministicRepairGeneration(
  parentPlanHash: `sha256:${string}`,
  parentGeneration: number,
  strategyId: string,
  driftVectorIds: string[],
): PlanLineage {
  return {
    parent_plan_hash: parentPlanHash,
    mutation_type: 'repair_deterministic',
    mutation_reason: `Deterministic repair: ${strategyId}`,
    generation: parentGeneration + 1,
    deterministic_repair: {
      strategy_id: strategyId,
      drift_vectors: driftVectorIds,
    },
  };
}

/** Create a new generation for LLM repair */
export function createLLMRepairGeneration(
  parentPlanHash: `sha256:${string}`,
  parentGeneration: number,
  driftVectorIds: string[],
  repairPromptHash: `sha256:${string}`,
  repairSignature: PlannerSignature,
  mutationsApplied: AppliedMutation[],
): PlanLineage {
  return {
    parent_plan_hash: parentPlanHash,
    mutation_type: 'repair_llm',
    mutation_reason: `LLM repair: ${mutationsApplied.length} mutation(s) applied`,
    generation: parentGeneration + 1,
    repair_context: {
      drift_vectors: driftVectorIds,
      repair_prompt_hash: repairPromptHash,
      repair_signature: repairSignature,
      mutations_applied: mutationsApplied,
    },
  };
}

/** Save a generation to ~/.continuum/generations/<hash>/ */
export function saveGeneration(
  plan: ExecutionPlan,
  lineage: PlanLineage,
  assertionResults?: AssertionResult[],
  runId?: string,
): `sha256:${string}` {
  const planHash = hashObject(plan);
  const dir = getGenerationDir(planHash);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan, null, 2), 'utf8');
  writeFileSync(join(dir, 'lineage.json'), JSON.stringify(lineage, null, 2), 'utf8');

  if (assertionResults) {
    writeFileSync(join(dir, 'verification.json'), JSON.stringify({
      assertion_results: assertionResults,
      run_id: runId,
      verified_at: new Date().toISOString(),
    }, null, 2), 'utf8');
  }

  return planHash;
}

/** Load a generation's lineage */
export function loadLineage(planHash: `sha256:${string}`): PlanLineage | null {
  const dir = getGenerationDir(planHash);
  const path = join(dir, 'lineage.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Load a generation's plan */
export function loadGenerationPlan(planHash: `sha256:${string}`): ExecutionPlan | null {
  const dir = getGenerationDir(planHash);
  const path = join(dir, 'plan.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Get the full lineage chain for a plan hash */
export function getLineageChain(planHash: `sha256:${string}`): Array<{
  planHash: `sha256:${string}`;
  lineage: PlanLineage;
}> {
  const chain: Array<{ planHash: `sha256:${string}`; lineage: PlanLineage }> = [];
  let currentHash: `sha256:${string}` | undefined = planHash;

  while (currentHash) {
    const lineage = loadLineage(currentHash);
    if (!lineage) break;
    chain.unshift({ planHash: currentHash, lineage });
    currentHash = lineage.parent_plan_hash;
  }

  return chain;
}
