import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { assertValidPlan } from '../core/validator.js';
import {
  loadGenerationPlan,
  loadLineage,
  saveGeneration,
  createManualEditGeneration,
} from '../core/lineage.js';
import type { ExecutionPlan } from '../types/execution-plan.js';

export const editCommand = new Command('edit')
  .description('Track a manual edit to a plan with full lineage');

editCommand
  .command('apply')
  .description('Apply a modified plan file and record it as a manual edit generation')
  .argument('<plan_file>', 'Path to the modified plan JSON file')
  .option('--parent <hash>', 'Parent plan hash (auto-detected from generations if omitted)')
  .option('--reason <text>', 'Reason for the edit', 'Manual modification')
  .option('--json', 'Output result as JSON')
  .action((planFile: string, opts: {
    parent?: string;
    reason: string;
    json?: boolean;
  }) => {
    try {
      const filePath = resolve(planFile);
      if (!existsSync(filePath)) {
        console.error(chalk.red(`File not found: ${filePath}`));
        process.exit(1);
      }

      // Load and validate the new plan
      let newPlan: ExecutionPlan;
      try {
        newPlan = JSON.parse(readFileSync(filePath, 'utf8'));
        assertValidPlan(newPlan);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Invalid plan: ${msg}`));
        process.exit(1);
      }

      // Determine parent
      let parentHash: `sha256:${string}` | undefined;
      let parentGeneration = -1;

      if (opts.parent) {
        parentHash = opts.parent.startsWith('sha256:')
          ? opts.parent as `sha256:${string}`
          : `sha256:${opts.parent}`;
        const lineage = loadLineage(parentHash);
        if (lineage) {
          parentGeneration = lineage.generation;
        }
      }

      // Find which steps differ from parent
      let editedSteps: string[] = [];
      if (parentHash) {
        const parentPlan = loadGenerationPlan(parentHash);
        if (parentPlan) {
          const parentStepMap = new Map(parentPlan.steps.map((s) => [s.step_id, s]));
          for (const step of newPlan.steps) {
            const orig = parentStepMap.get(step.step_id);
            if (!orig) {
              editedSteps.push(step.step_id);
            } else if (JSON.stringify(orig) !== JSON.stringify(step)) {
              editedSteps.push(step.step_id);
            }
          }
          // Steps removed in new plan
          for (const origStep of parentPlan.steps) {
            if (!newPlan.steps.some((s) => s.step_id === origStep.step_id)) {
              editedSteps.push(origStep.step_id);
            }
          }
        }
      }

      if (editedSteps.length === 0) {
        editedSteps = newPlan.steps.map((s) => s.step_id);
      }

      const lineage = createManualEditGeneration(
        parentHash ?? `sha256:${'0'.repeat(64)}`,
        parentGeneration,
        opts.reason,
        editedSteps,
      );

      const newHash = saveGeneration(newPlan, lineage);

      if (opts.json) {
        console.log(JSON.stringify({
          plan_hash: newHash,
          parent_hash: parentHash ?? null,
          generation: lineage.generation,
          mutation_type: 'manual_edit',
          edited_steps: editedSteps,
          reason: opts.reason,
        }, null, 2));
      } else {
        console.log(chalk.green('Manual edit recorded.'));
        console.log(chalk.gray(`Plan hash:   ${newHash}`));
        if (parentHash) console.log(chalk.gray(`Parent:      ${parentHash}`));
        console.log(chalk.gray(`Generation:  ${lineage.generation}`));
        console.log(chalk.gray(`Edited:      ${editedSteps.length} step(s)`));
        console.log(chalk.gray(`Reason:      ${opts.reason}`));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(msg));
      process.exit(1);
    }
  });

editCommand
  .command('export')
  .description('Export a plan from generations for manual editing')
  .argument('<plan_hash>', 'Plan hash to export')
  .option('-o, --output <file>', 'Output file path', 'plan-edit.json')
  .action((planHash: string, opts: { output: string }) => {
    try {
      const hash: `sha256:${string}` = planHash.startsWith('sha256:')
        ? planHash as `sha256:${string}`
        : `sha256:${planHash}` as `sha256:${string}`;

      const plan = loadGenerationPlan(hash);
      if (!plan) {
        console.error(chalk.red(`Plan not found: ${hash}`));
        process.exit(1);
      }

      const outPath = resolve(opts.output);
      writeFileSync(outPath, JSON.stringify(plan, null, 2), 'utf8');
      console.log(chalk.green(`Exported plan to ${outPath}`));
      console.log(chalk.gray(`Hash: ${hash}`));
      console.log(chalk.gray(`Steps: ${plan.steps.length}`));
      console.log();
      console.log(chalk.gray('Edit the file, then run:'));
      console.log(chalk.cyan(`  continuum edit apply ${outPath} --parent ${hash}`));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(msg));
      process.exit(1);
    }
  });
