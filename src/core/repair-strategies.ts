import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DriftVector } from '../types/drift-vector.js';
import type { RepairAction, DeterministicRepairStrategy } from '../types/repair.js';
import { getRunDir } from './paths.js';

/** MVP + v3.1 deterministic repair strategies */
export const STRATEGIES: DeterministicRepairStrategy[] = [
  {
    id: 'npm-clean-install',
    matches: (d) => d.category === 'dependency' && d.severity !== 'blocking',
    repair: () => [
      { type: 'run_command', command: 'rm', args: ['-rf', 'node_modules'] },
      { type: 'run_command', command: 'npm', args: ['ci'] },
    ],
    description: 'Clean reinstall from lockfile',
  },
  {
    id: 'timeout-increase',
    matches: (d) => d.category === 'timeout',
    repair: (d) => [
      {
        type: 'update_step',
        step_id: d.details.step_id,
        field: 'timeout_ms',
        value: (d.details.step_order + 1) * 60000,
      },
    ],
    description: 'Increase step timeout to 60s per step',
  },
  {
    id: 'missing-input-from-artifacts',
    matches: (d) => d.category === 'missing_input',
    repair: (d) => [
      {
        type: 'restore_artifact',
        path: d.details.expected,
        from_run: d.source_run_id,
      },
    ],
    description: 'Restore missing file from original run artifacts',
  },
  // ── v3.1: Permission fix strategy ──
  {
    id: 'fix-permissions',
    matches: (d) => d.category === 'permission',
    repair: (d) => {
      const path = d.details.expected || '.';
      return [
        { type: 'run_command', command: 'chmod', args: ['-R', '755', path] },
      ];
    },
    description: 'Fix file/directory permissions (chmod 755)',
  },
  // ── v3.1: Version pinning via lockfile regeneration ──
  {
    id: 'version-pin-regenerate-lock',
    matches: (d) =>
      d.category === 'dependency' &&
      d.severity === 'cosmetic' &&
      !!d.details.diff?.includes('Lockfile'),
    repair: () => [
      { type: 'run_command', command: 'npm', args: ['install', '--package-lock-only'] },
    ],
    description: 'Regenerate lockfile without changing node_modules',
  },
  // ── v3.1: Cache clean for environment-related failures ──
  {
    id: 'npm-cache-clean',
    matches: (d) =>
      d.category === 'environment' &&
      d.severity === 'degraded' &&
      d.details.env_key === 'npm',
    repair: () => [
      { type: 'run_command', command: 'npm', args: ['cache', 'clean', '--force'] },
      { type: 'run_command', command: 'rm', args: ['-rf', 'node_modules'] },
      { type: 'run_command', command: 'npm', args: ['ci'] },
    ],
    description: 'Clean npm cache and reinstall dependencies',
  },
  // ── v3.1: Tool unavailable — try npx fallback ──
  {
    id: 'tool-unavailable-npx',
    matches: (d) => d.category === 'tool_unavailable',
    repair: (d) => {
      const toolName = d.details.expected || 'unknown-tool';
      return [
        { type: 'run_command', command: 'npx', args: [toolName, '--version'] },
      ];
    },
    description: 'Attempt to run unavailable tool via npx',
  },
];

/** Find matching strategies for a drift vector */
export function findMatchingStrategies(drift: DriftVector): DeterministicRepairStrategy[] {
  return STRATEGIES.filter((s) => s.matches(drift));
}

/** Execute a repair action in the sandbox */
export async function executeRepairAction(
  action: RepairAction,
  sandbox: {
    exec(cmd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }>;
    writeFile?(relativePath: string, content: string): Promise<void>;
  },
): Promise<{ success: boolean; error?: string }> {
  switch (action.type) {
    case 'run_command': {
      try {
        const result = await sandbox.exec(action.command, action.args);
        return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    case 'update_step':
      // Step updates are handled at the plan level, not in sandbox
      return { success: true };
    case 'restore_artifact': {
      // Attempt to restore artifact from the original run's workspace
      try {
        const runDir = getRunDir(action.from_run);
        const summaryPath = join(runDir, 'summary.json');
        if (!existsSync(summaryPath)) {
          return { success: false, error: `Source run not found: ${action.from_run}` };
        }
        const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
        const origWorkspace = summary.workspace;
        if (!origWorkspace) {
          return { success: false, error: 'Original run has no workspace path recorded' };
        }
        const sourcePath = join(origWorkspace, action.path);
        if (!existsSync(sourcePath)) {
          return { success: false, error: `Artifact not found in original workspace: ${action.path}` };
        }
        const content = readFileSync(sourcePath, 'utf8');
        if (sandbox.writeFile) {
          await sandbox.writeFile(action.path, content);
          return { success: true };
        }
        return { success: false, error: 'Sandbox does not support writeFile' };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }
}
