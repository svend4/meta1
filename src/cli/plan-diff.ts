import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { diffPlans } from '../core/plan-diff.js';
import { assertValidPlan } from '../core/validator.js';
import type { ExecutionPlan } from '../types/execution-plan.js';

export const planDiffCommand = new Command('plan-diff')
  .description('Compare two execution plans structurally')
  .argument('<plan-a>', 'Path to first plan JSON file')
  .argument('<plan-b>', 'Path to second plan JSON file')
  .option('--json', 'Output as JSON')
  .action(async (planAPath: string, planBPath: string, opts: { json?: boolean }) => {
    const planA = loadPlan(planAPath);
    const planB = loadPlan(planBPath);

    const result = diffPlans(planA, planB);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(chalk.bold('Plan Diff'));
    console.log(chalk.dim(`  A: ${planAPath}`));
    console.log(chalk.dim(`  B: ${planBPath}`));
    console.log('');

    if (result.planIdChanged) console.log(chalk.yellow('  plan_id: changed'));
    if (result.descriptionChanged) console.log(chalk.yellow('  description: changed'));
    if (result.executionModeChanged) console.log(chalk.yellow('  execution_mode: changed'));

    for (const sd of result.stepDiffs) {
      if (sd.change === 'unchanged') continue;

      if (sd.change === 'added') {
        console.log(chalk.green(`  + ${sd.stepId} (added)`));
      } else if (sd.change === 'removed') {
        console.log(chalk.red(`  - ${sd.stepId} (removed)`));
      } else if (sd.change === 'modified' && sd.fields) {
        console.log(chalk.yellow(`  ~ ${sd.stepId} (modified)`));
        for (const f of sd.fields) {
          console.log(chalk.dim(`      ${f.field}: `) + chalk.red(f.old ?? '') + chalk.dim(' → ') + chalk.green(f.new ?? ''));
        }
      }
    }

    console.log('');
    console.log(chalk.bold('Summary: ') + result.summary);

    if (result.stepsAdded.length === 0 && result.stepsRemoved.length === 0 && result.stepsModified.length === 0) {
      console.log(chalk.green('Plans are structurally identical.'));
    }
  });

function loadPlan(path: string): ExecutionPlan {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  assertValidPlan(raw);
  return raw as ExecutionPlan;
}
