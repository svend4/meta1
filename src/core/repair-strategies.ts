import type { DriftVector } from '../types/drift-vector.js';
import type { RepairAction, DeterministicRepairStrategy } from '../types/repair.js';

/** MVP deterministic repair strategies (hardcoded) */
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
];

/** Find matching strategies for a drift vector */
export function findMatchingStrategies(drift: DriftVector): DeterministicRepairStrategy[] {
  return STRATEGIES.filter((s) => s.matches(drift));
}

/** Execute a repair action in the sandbox */
export async function executeRepairAction(
  action: RepairAction,
  sandbox: { exec(cmd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> },
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
    case 'restore_artifact':
      // Would need access to run storage — for MVP, mark as attempted
      return { success: false, error: 'Artifact restoration not yet implemented in MVP' };
  }
}
