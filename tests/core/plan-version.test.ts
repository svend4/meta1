import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createPlanVersion,
  loadPlanHistory,
  loadPlanVersion,
  computeSemanticDiff,
  formatPlanHistory,
} from '../../src/core/plan-version.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';

let tempDir: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
}));

function makePlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    plan_id: 'test-plan',
    steps: [
      { step_id: 's1', type: 'create_file', description: 'Create config', path: 'config.json', content: '{}', determinism: 'guaranteed' },
    ],
    ...overrides,
  };
}

describe('plan-version', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-pv-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates first version', () => {
    const plan = makePlan();
    const v = createPlanVersion(plan, 'Initial plan');

    expect(v.version).toBe(1);
    expect(v.changeDescription).toBe('Initial plan');
    expect(v.changes).toHaveLength(1);
    expect(v.planHash).toMatch(/^[a-f0-9]+$/);
  });

  it('creates subsequent versions with diffs', () => {
    const plan1 = makePlan();
    createPlanVersion(plan1, 'Initial');

    const plan2 = makePlan({
      steps: [
        { step_id: 's1', type: 'create_file', description: 'Create config', path: 'config.json', content: '{"updated": true}', determinism: 'guaranteed' },
        { step_id: 's2', type: 'run_command', description: 'Build', command: 'npm', args: ['build'], determinism: 'best_effort' },
      ],
    });
    const v2 = createPlanVersion(plan2, 'Add build step');

    expect(v2.version).toBe(2);
    expect(v2.changes.some((c) => c.type === 'step_added')).toBe(true);
    expect(v2.changes.some((c) => c.type === 'step_modified')).toBe(true);
  });

  it('loads plan history', () => {
    const plan = makePlan();
    createPlanVersion(plan, 'v1');
    createPlanVersion(plan, 'v2');

    const history = loadPlanHistory('test-plan');
    expect(history.versions).toHaveLength(2);
    expect(history.currentVersion).toBe(2);
  });

  it('loads specific version', () => {
    const plan = makePlan();
    createPlanVersion(plan, 'v1');

    const v = loadPlanVersion('test-plan', 1);
    expect(v).toBeDefined();
    expect(v!.version).toBe(1);
    expect(v!.plan.plan_id).toBe('test-plan');
  });

  it('returns null for nonexistent version', () => {
    expect(loadPlanVersion('ghost', 99)).toBeNull();
  });

  it('returns empty history for unknown plan', () => {
    const history = loadPlanHistory('ghost');
    expect(history.versions).toHaveLength(0);
    expect(history.currentVersion).toBe(0);
  });
});

describe('computeSemanticDiff', () => {
  it('detects added steps', () => {
    const old = makePlan();
    const newPlan = makePlan({
      steps: [
        ...old.steps,
        { step_id: 's2', type: 'run_command', description: 'Build', command: 'npm', args: ['build'], determinism: 'best_effort' },
      ],
    });

    const changes = computeSemanticDiff(old, newPlan);
    expect(changes.some((c) => c.type === 'step_added' && c.stepId === 's2')).toBe(true);
  });

  it('detects removed steps', () => {
    const old = makePlan({
      steps: [
        { step_id: 's1', type: 'create_file', description: 'a', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 's2', type: 'create_file', description: 'b', path: 'b', content: '', determinism: 'guaranteed' },
      ],
    });
    const newPlan = makePlan({ steps: [old.steps[0]] });

    const changes = computeSemanticDiff(old, newPlan);
    expect(changes.some((c) => c.type === 'step_removed' && c.stepId === 's2')).toBe(true);
  });

  it('detects modified description', () => {
    const old = makePlan();
    const newPlan = makePlan({
      steps: [{ ...old.steps[0], description: 'Updated description' }],
    });

    const changes = computeSemanticDiff(old, newPlan);
    expect(changes.some((c) => c.type === 'step_modified' && c.field === 'description')).toBe(true);
  });

  it('detects mode change', () => {
    const old = makePlan({ execution_mode: 'sequential' });
    const newPlan = makePlan({ execution_mode: 'parallel' });

    const changes = computeSemanticDiff(old, newPlan);
    expect(changes.some((c) => c.type === 'mode_changed')).toBe(true);
  });

  it('detects no changes', () => {
    const plan = makePlan();
    const changes = computeSemanticDiff(plan, plan);
    expect(changes).toHaveLength(0);
  });
});

describe('formatPlanHistory', () => {
  it('formats history for display', () => {
    const plan = makePlan();
    createPlanVersion(plan, 'Initial');
    const history = loadPlanHistory('test-plan');

    const output = formatPlanHistory(history);
    expect(output).toContain('test-plan');
    expect(output).toContain('v1');
    expect(output).toContain('Initial');
  });
});
