import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { STRATEGIES, findMatchingStrategies, executeRepairAction } from '../../src/core/repair-strategies.js';
import type { DriftVector } from '../../src/types/drift-vector.js';
import type { RepairAction } from '../../src/types/repair.js';
import { LocalSandbox } from '../../src/sandbox/local.js';
import * as paths from '../../src/core/paths.js';

let tempDir: string;

function makeDrift(overrides: Partial<DriftVector>): DriftVector {
  return {
    drift_id: randomUUID(),
    detected_at: new Date().toISOString(),
    run_id: 'test-run',
    source_run_id: 'source-run',
    category: 'dependency',
    severity: 'cosmetic',
    repairable: true,
    repair_level: 2,
    details: {
      step_id: 'step-1',
      step_order: 0,
      expected: 'expected-value',
      actual: 'actual-value',
    },
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-repair-test-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('STRATEGIES registry', () => {
  it('has at least 7 strategies registered', () => {
    expect(STRATEGIES.length).toBeGreaterThanOrEqual(7);
  });

  it('each strategy has required fields', () => {
    for (const strategy of STRATEGIES) {
      expect(strategy.id).toBeDefined();
      expect(typeof strategy.matches).toBe('function');
      expect(typeof strategy.repair).toBe('function');
      expect(strategy.description).toBeDefined();
    }
  });

  it('all strategy IDs are unique', () => {
    const ids = STRATEGIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('findMatchingStrategies', () => {
  it('matches npm-clean-install for non-blocking dependency drift', () => {
    const drift = makeDrift({ category: 'dependency', severity: 'cosmetic' });
    const matches = findMatchingStrategies(drift);
    expect(matches.some((s) => s.id === 'npm-clean-install')).toBe(true);
  });

  it('does not match npm-clean-install for blocking dependency drift', () => {
    const drift = makeDrift({ category: 'dependency', severity: 'blocking' });
    const matches = findMatchingStrategies(drift);
    expect(matches.some((s) => s.id === 'npm-clean-install')).toBe(false);
  });

  it('matches timeout-increase for timeout drift', () => {
    const drift = makeDrift({ category: 'timeout' });
    const matches = findMatchingStrategies(drift);
    expect(matches.some((s) => s.id === 'timeout-increase')).toBe(true);
  });

  it('matches missing-input-from-artifacts for missing_input drift', () => {
    const drift = makeDrift({ category: 'missing_input' });
    const matches = findMatchingStrategies(drift);
    expect(matches.some((s) => s.id === 'missing-input-from-artifacts')).toBe(true);
  });

  it('matches fix-permissions for permission drift', () => {
    const drift = makeDrift({ category: 'permission' });
    const matches = findMatchingStrategies(drift);
    expect(matches.some((s) => s.id === 'fix-permissions')).toBe(true);
  });

  it('matches version-pin-regenerate-lock for lockfile drift', () => {
    const drift = makeDrift({
      category: 'dependency',
      severity: 'cosmetic',
      details: {
        step_id: '',
        step_order: -1,
        expected: 'sha256:old',
        actual: 'sha256:new',
        diff: 'Lockfile package-lock.json hash changed',
      },
    });
    const matches = findMatchingStrategies(drift);
    expect(matches.some((s) => s.id === 'version-pin-regenerate-lock')).toBe(true);
  });

  it('matches npm-cache-clean for degraded npm environment drift', () => {
    const drift = makeDrift({
      category: 'environment',
      severity: 'degraded',
      details: {
        step_id: '',
        step_order: -1,
        expected: '10.0.0',
        actual: '10.5.0',
        env_key: 'npm',
      },
    });
    const matches = findMatchingStrategies(drift);
    expect(matches.some((s) => s.id === 'npm-cache-clean')).toBe(true);
  });

  it('matches tool-unavailable-npx for tool_unavailable drift', () => {
    const drift = makeDrift({ category: 'tool_unavailable' });
    const matches = findMatchingStrategies(drift);
    expect(matches.some((s) => s.id === 'tool-unavailable-npx')).toBe(true);
  });

  it('returns empty array when no strategy matches', () => {
    const drift = makeDrift({ category: 'assertion_stable' });
    const matches = findMatchingStrategies(drift);
    expect(matches).toHaveLength(0);
  });
});

describe('strategy repair actions', () => {
  it('npm-clean-install produces two run_command actions', () => {
    const strategy = STRATEGIES.find((s) => s.id === 'npm-clean-install')!;
    const drift = makeDrift({ category: 'dependency', severity: 'cosmetic' });
    const actions = strategy.repair(drift, { workspace: tempDir, source_run_id: 'src' });
    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({ type: 'run_command', command: 'rm', args: ['-rf', 'node_modules'] });
    expect(actions[1]).toEqual({ type: 'run_command', command: 'npm', args: ['ci'] });
  });

  it('timeout-increase produces update_step action with computed timeout', () => {
    const strategy = STRATEGIES.find((s) => s.id === 'timeout-increase')!;
    const drift = makeDrift({
      category: 'timeout',
      details: { step_id: 'step-3', step_order: 2, expected: '30000', actual: 'timeout' },
    });
    const actions = strategy.repair(drift, { workspace: tempDir, source_run_id: 'src' });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      type: 'update_step',
      step_id: 'step-3',
      field: 'timeout_ms',
      value: 180000, // (2+1) * 60000
    });
  });

  it('fix-permissions produces chmod command', () => {
    const strategy = STRATEGIES.find((s) => s.id === 'fix-permissions')!;
    const drift = makeDrift({
      category: 'permission',
      details: { step_id: 's1', step_order: 0, expected: 'scripts/build.sh', actual: 'permission denied' },
    });
    const actions = strategy.repair(drift, { workspace: tempDir, source_run_id: 'src' });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      type: 'run_command',
      command: 'chmod',
      args: ['-R', '755', 'scripts/build.sh'],
    });
  });

  it('npm-cache-clean produces three actions', () => {
    const strategy = STRATEGIES.find((s) => s.id === 'npm-cache-clean')!;
    const drift = makeDrift({
      category: 'environment',
      severity: 'degraded',
      details: { step_id: '', step_order: -1, expected: '10.0.0', actual: '10.5.0', env_key: 'npm' },
    });
    const actions = strategy.repair(drift, { workspace: tempDir, source_run_id: 'src' });
    expect(actions).toHaveLength(3);
    expect(actions[0].type).toBe('run_command');
    expect(actions[2]).toEqual({ type: 'run_command', command: 'npm', args: ['ci'] });
  });

  it('tool-unavailable-npx uses tool name from expected', () => {
    const strategy = STRATEGIES.find((s) => s.id === 'tool-unavailable-npx')!;
    const drift = makeDrift({
      category: 'tool_unavailable',
      details: { step_id: 's1', step_order: 0, expected: 'tsc', actual: 'not found' },
    });
    const actions = strategy.repair(drift, { workspace: tempDir, source_run_id: 'src' });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ type: 'run_command', command: 'npx', args: ['tsc', '--version'] });
  });
});

describe('executeRepairAction', () => {
  it('executes run_command successfully', async () => {
    const workspace = join(tempDir, 'ws');
    const sandbox = new LocalSandbox(workspace);
    await sandbox.init();

    const action: RepairAction = { type: 'run_command', command: 'node', args: ['-e', 'process.exit(0)'] };
    const result = await executeRepairAction(action, sandbox);
    expect(result.success).toBe(true);
  });

  it('reports failure for non-zero exit code', async () => {
    const workspace = join(tempDir, 'ws');
    const sandbox = new LocalSandbox(workspace);
    await sandbox.init();

    const action: RepairAction = { type: 'run_command', command: 'node', args: ['-e', 'process.exit(1)'] };
    const result = await executeRepairAction(action, sandbox);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('handles update_step as a plan-level action (always succeeds)', async () => {
    const sandbox = new LocalSandbox(join(tempDir, 'ws'));
    const action: RepairAction = { type: 'update_step', step_id: 's1', field: 'timeout_ms', value: 60000 };
    const result = await executeRepairAction(action, sandbox);
    expect(result.success).toBe(true);
  });

  it('restores artifact from original run workspace when available', async () => {
    const runId = 'original-run-123';
    const runsDir = join(tempDir, 'runs', runId);
    const origWorkspace = join(tempDir, 'orig-ws');

    // Set up original run data
    mkdirSync(runsDir, { recursive: true });
    mkdirSync(origWorkspace, { recursive: true });
    writeFileSync(join(origWorkspace, 'restored.txt'), 'original content', 'utf8');
    writeFileSync(join(runsDir, 'summary.json'), JSON.stringify({
      run_id: runId,
      workspace: origWorkspace,
    }), 'utf8');

    // Redirect storage to temp dir
    vi.spyOn(paths, 'getRunDir').mockImplementation((id) => join(tempDir, 'runs', id));

    const workspace = join(tempDir, 'target-ws');
    const sandbox = new LocalSandbox(workspace);
    await sandbox.init();

    const action: RepairAction = { type: 'restore_artifact', path: 'restored.txt', from_run: runId };
    const result = await executeRepairAction(action, sandbox);
    expect(result.success).toBe(true);

    // Verify file was restored
    const content = await sandbox.readFile('restored.txt');
    expect(content).toBe('original content');
  });

  it('fails restore when source run not found', async () => {
    vi.spyOn(paths, 'getRunDir').mockImplementation((id) => join(tempDir, 'runs', id));

    const sandbox = new LocalSandbox(join(tempDir, 'ws'));
    await sandbox.init();

    const action: RepairAction = { type: 'restore_artifact', path: 'file.txt', from_run: 'nonexistent' };
    const result = await executeRepairAction(action, sandbox);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Source run not found');
  });
});
