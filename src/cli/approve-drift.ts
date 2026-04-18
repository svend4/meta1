import { Command } from 'commander';
import chalk from 'chalk';
import { loadRunSummary } from '../storage/runs.js';
import { isPlanV3 } from '../types/execution-plan.js';
import type { ExecutionPlanV3 } from '../types/execution-plan.js';
import {
  createBenignDriftGeneration,
  saveGeneration,
  loadLineage,
} from '../core/lineage.js';
import { hashObject } from '../core/hasher.js';

export const approveDriftCommand = new Command('approve-drift')
  .description('Accept benign drift from a replay run and create a new plan generation')
  .argument('<replay_run_id>', 'ID of the replay run to approve')
  .option('--reason <text>', 'Optional reason for approval')
  .action(async (replayRunId: string, opts: { reason?: string }) => {
    try {
      const summary = loadRunSummary(replayRunId);

      if (summary.status !== 'benign_drift' && summary.status !== 'completed') {
        console.error(chalk.red(`Run ${replayRunId} has status "${summary.status}" — only benign_drift or completed runs can be approved.`));
        process.exit(1);
      }

      if (!isPlanV3(summary.plan)) {
        console.error(chalk.red('Only v3.0 plans support drift approval.'));
        process.exit(1);
      }

      const v3Plan = summary.plan as ExecutionPlanV3;
      const planHash = hashObject(summary.plan);

      // Check if already approved (generation already exists)
      const existingLineage = loadLineage(planHash);
      if (existingLineage && existingLineage.mutation_type === 'benign_drift_accepted') {
        console.log(chalk.yellow(`Generation for ${planHash.slice(0, 19)}... already exists (gen ${existingLineage.generation}).`));
        console.log(chalk.yellow('Drift was already accepted.'));
        return;
      }

      const parentGeneration = v3Plan.lineage?.generation ?? 0;

      // Build changed artifacts from step results
      const changedArtifacts: Array<{
        path: string;
        old_hash: `sha256:${string}`;
        new_hash: `sha256:${string}`;
      }> = [];

      for (const step of summary.steps) {
        if (step.artifact_hash) {
          const planStep = summary.plan.steps.find((s) => s.step_id === step.step_id);
          if (planStep) {
            // We record artifact paths for create_file steps
            const path = planStep.type === 'create_file' ? planStep.path : step.step_id;
            changedArtifacts.push({
              path,
              old_hash: step.artifact_hash, // current hash
              new_hash: step.artifact_hash,
            });
          }
        }
      }

      const reason = opts.reason
        ? `${opts.reason} (manual approval)`
        : undefined;

      const lineage = createBenignDriftGeneration(planHash, parentGeneration, changedArtifacts);
      if (reason) {
        lineage.mutation_reason = reason;
      }

      const newPlanHash = saveGeneration(
        summary.plan,
        lineage,
        summary.assertion_results,
        replayRunId,
      );

      console.log(chalk.green('Drift approved successfully.'));
      console.log(chalk.gray(`Plan hash:   ${newPlanHash}`));
      console.log(chalk.gray(`Generation:  ${lineage.generation}`));
      console.log(chalk.gray(`Parent:      ${planHash.slice(0, 19)}...`));
      console.log(chalk.gray(`Artifacts:   ${changedArtifacts.length} tracked`));
      if (reason) {
        console.log(chalk.gray(`Reason:      ${reason}`));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
      process.exit(1);
    }
  });
