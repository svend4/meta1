import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExecutionPlan } from '../types/execution-plan.js';
import type { PlanLineage } from '../types/plan-lineage.js';
import { hashObject } from './hasher.js';
import { assertValidPlan } from './validator.js';
import { loadLineage, loadGenerationPlan, getLineageChain, saveGeneration } from './lineage.js';

/** A portable plan bundle containing plan + lineage + metadata */
export interface PlanBundle {
  version: '1.0';
  exported_at: string;
  plan: ExecutionPlan;
  plan_hash: `sha256:${string}`;
  lineage_chain: Array<{
    plan_hash: `sha256:${string}`;
    lineage: PlanLineage;
  }>;
  metadata: {
    source_host?: string;
    node_version?: string;
    platform?: string;
    description?: string;
  };
  bundle_hash: `sha256:${string}`;
}

/**
 * Export a plan and its full lineage chain into a portable bundle.
 */
export function exportBundle(
  planHash: `sha256:${string}`,
  options?: { description?: string },
): PlanBundle {
  const plan = loadGenerationPlan(planHash);
  if (!plan) {
    throw new Error(`Plan not found: ${planHash}`);
  }

  const chain = getLineageChain(planHash).map((e) => ({
    plan_hash: e.planHash,
    lineage: e.lineage,
  }));

  const bundle: Omit<PlanBundle, 'bundle_hash'> = {
    version: '1.0',
    exported_at: new Date().toISOString(),
    plan,
    plan_hash: planHash,
    lineage_chain: chain,
    metadata: {
      node_version: process.version,
      platform: process.platform,
      description: options?.description,
    },
  };

  // Compute bundle integrity hash
  const bundleHash = hashObject(bundle);

  return { ...bundle, bundle_hash: bundleHash };
}

/**
 * Save a plan bundle to a file.
 */
export function saveBundleToFile(bundle: PlanBundle, filePath: string): void {
  writeFileSync(resolve(filePath), JSON.stringify(bundle, null, 2), 'utf8');
}

/**
 * Load a plan bundle from a file.
 * Validates bundle integrity.
 */
export function loadBundleFromFile(filePath: string): PlanBundle {
  const fullPath = resolve(filePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Bundle file not found: ${fullPath}`);
  }

  const bundle = JSON.parse(readFileSync(fullPath, 'utf8')) as PlanBundle;

  if (bundle.version !== '1.0') {
    throw new Error(`Unsupported bundle version: ${bundle.version}`);
  }

  // Verify integrity
  const { bundle_hash, ...rest } = bundle;
  const computedHash = hashObject(rest);
  if (computedHash !== bundle_hash) {
    throw new Error(
      `Bundle integrity check failed: expected ${bundle_hash}, got ${computedHash}. ` +
      `The bundle may have been tampered with.`,
    );
  }

  // Validate the plan
  assertValidPlan(bundle.plan);

  return bundle;
}

/**
 * Import a plan bundle into the local generations store.
 * Imports the full lineage chain so history is preserved.
 * Returns the imported plan hash.
 */
export function importBundle(bundle: PlanBundle): `sha256:${string}` {
  // Import each generation in the chain
  for (const entry of bundle.lineage_chain) {
    // Check if this generation already exists
    const existing = loadLineage(entry.plan_hash);
    if (existing) continue;

    // Load plan from chain — for non-leaf nodes we need the plan from generations
    // The leaf plan is in the bundle directly
    if (entry.plan_hash === bundle.plan_hash) {
      saveGeneration(bundle.plan, entry.lineage);
    } else {
      // For ancestor plans, we can only save lineage (plan data not in bundle)
      // Re-check if plan exists; if not, create a stub generation
      const existingPlan = loadGenerationPlan(entry.plan_hash);
      if (!existingPlan) {
        // Save lineage only — plan data is not portable for ancestors
        // This is a known limitation; full bundle export would need all plans
        saveGeneration(
          { plan_id: `imported-${entry.plan_hash.slice(7, 19)}`, steps: [] } as ExecutionPlan,
          entry.lineage,
        );
      }
    }
  }

  // If no chain entries, save the plan as original generation
  if (bundle.lineage_chain.length === 0) {
    saveGeneration(bundle.plan, {
      mutation_type: 'original',
      generation: 0,
      mutation_reason: 'Imported from bundle',
    });
  }

  return bundle.plan_hash;
}
