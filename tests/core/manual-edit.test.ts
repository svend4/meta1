import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createManualEditGeneration,
  createOriginalLineage,
  saveGeneration,
  loadLineage,
  getLineageChain,
} from '../../src/core/lineage.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';
import * as paths from '../../src/core/paths.js';

let tempDir: string;

const basePlan: ExecutionPlan = {
  plan_id: 'manual-edit-test',
  steps: [
    {
      step_id: 'step-1',
      type: 'create_file',
      description: 'Create original file',
      path: '/tmp/original.txt',
      content: 'original content',
      determinism: 'guaranteed' as const,
    },
  ],
};

const editedPlan: ExecutionPlan = {
  plan_id: 'manual-edit-test',
  steps: [
    {
      step_id: 'step-1',
      type: 'create_file',
      description: 'Create updated file',
      path: '/tmp/original.txt',
      content: 'modified content',
      determinism: 'guaranteed' as const,
    },
  ],
};

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-manualedit-'));
  vi.spyOn(paths, 'getBaseDir').mockReturnValue(tempDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('manual edit lineage', () => {
  it('creates a manual_edit lineage with correct fields', () => {
    const lineage = createManualEditGeneration(
      'sha256:parent123',
      0,
      'Fixed typo in content',
      ['step-1'],
    );

    expect(lineage.mutation_type).toBe('manual_edit');
    expect(lineage.parent_plan_hash).toBe('sha256:parent123');
    expect(lineage.generation).toBe(1);
    expect(lineage.mutation_reason).toContain('Manual edit');
    expect(lineage.mutation_reason).toContain('Fixed typo in content');
    expect(lineage.mutation_reason).toContain('step-1');
  });

  it('tracks generation number correctly through chain', () => {
    // Save original
    const originalHash = saveGeneration(basePlan, createOriginalLineage());

    // Save manual edit as gen 1
    const editLineage = createManualEditGeneration(
      originalHash,
      0,
      'Updated content',
      ['step-1'],
    );
    const editHash = saveGeneration(editedPlan, editLineage);

    // Verify chain
    const chain = getLineageChain(editHash);
    expect(chain).toHaveLength(2);
    expect(chain[0].lineage.mutation_type).toBe('original');
    expect(chain[0].lineage.generation).toBe(0);
    expect(chain[1].lineage.mutation_type).toBe('manual_edit');
    expect(chain[1].lineage.generation).toBe(1);
    expect(chain[1].lineage.parent_plan_hash).toBe(originalHash);
  });

  it('tracks multiple edited steps', () => {
    const lineage = createManualEditGeneration(
      'sha256:parent456',
      2,
      'Refactored multiple steps',
      ['step-1', 'step-3', 'step-5'],
    );

    expect(lineage.generation).toBe(3);
    expect(lineage.mutation_reason).toContain('step-1');
    expect(lineage.mutation_reason).toContain('step-3');
    expect(lineage.mutation_reason).toContain('step-5');
  });

  it('saves and loads manual edit generation', () => {
    const originalHash = saveGeneration(basePlan, createOriginalLineage());
    const editLineage = createManualEditGeneration(
      originalHash,
      0,
      'Fix',
      ['step-1'],
    );
    const editHash = saveGeneration(editedPlan, editLineage);

    const loaded = loadLineage(editHash);
    expect(loaded).not.toBeNull();
    expect(loaded!.mutation_type).toBe('manual_edit');
    expect(loaded!.parent_plan_hash).toBe(originalHash);
  });
});
