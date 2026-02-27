import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  exportBundle,
  saveBundleToFile,
  loadBundleFromFile,
  importBundle,
} from '../../src/core/plan-bundle.js';
import { saveGeneration, createOriginalLineage, loadLineage } from '../../src/core/lineage.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';
import * as paths from '../../src/core/paths.js';

let tempDir: string;

const testPlan: ExecutionPlan = {
  plan_id: randomUUID(),
  steps: [
    {
      step_id: 'step-1',
      type: 'create_file',
      description: 'Create test file',
      path: '/tmp/test.txt',
      content: 'hello',
      determinism: 'guaranteed' as const,
    },
  ],
};

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-bundle-'));
  vi.spyOn(paths, 'getBaseDir').mockReturnValue(tempDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('plan bundles', () => {
  it('exports a plan with lineage into a bundle', () => {
    const hash = saveGeneration(testPlan, createOriginalLineage());
    const bundle = exportBundle(hash);

    expect(bundle.version).toBe('1.0');
    expect(bundle.plan_hash).toBe(hash);
    expect(bundle.plan.plan_id).toBe(testPlan.plan_id);
    expect(bundle.lineage_chain).toHaveLength(1);
    expect(bundle.lineage_chain[0].plan_hash).toBe(hash);
    expect(bundle.bundle_hash).toMatch(/^sha256:/);
  });

  it('saves and loads a bundle file', () => {
    const hash = saveGeneration(testPlan, createOriginalLineage());
    const bundle = exportBundle(hash);
    const filePath = join(tempDir, 'test-bundle.json');

    saveBundleToFile(bundle, filePath);
    const loaded = loadBundleFromFile(filePath);

    expect(loaded.plan_hash).toBe(bundle.plan_hash);
    expect(loaded.bundle_hash).toBe(bundle.bundle_hash);
    expect(loaded.plan.steps).toHaveLength(1);
  });

  it('detects tampered bundle', () => {
    const hash = saveGeneration(testPlan, createOriginalLineage());
    const bundle = exportBundle(hash);
    const filePath = join(tempDir, 'tampered.json');

    // Tamper with the plan
    const tampered = { ...bundle, plan: { ...bundle.plan, plan_id: 'tampered' } };
    writeFileSync(filePath, JSON.stringify(tampered, null, 2), 'utf8');

    expect(() => loadBundleFromFile(filePath)).toThrow(/integrity check failed/);
  });

  it('imports a bundle into local generations', () => {
    // Create and export from "source"
    const hash = saveGeneration(testPlan, createOriginalLineage());
    const bundle = exportBundle(hash);
    const filePath = join(tempDir, 'export.json');
    saveBundleToFile(bundle, filePath);

    // Simulate fresh environment by clearing generations
    const genDir = join(tempDir, 'generations');
    rmSync(genDir, { recursive: true, force: true });

    // Import
    const loaded = loadBundleFromFile(filePath);
    const importedHash = importBundle(loaded);

    expect(importedHash).toBe(hash);
    // Lineage should be restored
    const lineage = loadLineage(importedHash);
    expect(lineage).not.toBeNull();
    expect(lineage!.mutation_type).toBe('original');
  });

  it('throws when plan not found for export', () => {
    expect(() => exportBundle('sha256:nonexistent' as `sha256:${string}`))
      .toThrow(/Plan not found/);
  });

  it('throws when bundle file not found', () => {
    expect(() => loadBundleFromFile('/nonexistent/path.json'))
      .toThrow(/Bundle file not found/);
  });

  it('includes metadata in bundle', () => {
    const hash = saveGeneration(testPlan, createOriginalLineage());
    const bundle = exportBundle(hash, { description: 'Test bundle' });

    expect(bundle.metadata.description).toBe('Test bundle');
    expect(bundle.metadata.node_version).toBeDefined();
    expect(bundle.metadata.platform).toBeDefined();
  });
});
