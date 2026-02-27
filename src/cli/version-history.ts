import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import {
  createPlanVersion,
  loadPlanHistory,
  loadPlanVersion,
  computeSemanticDiff,
  formatPlanHistory,
} from '../core/plan-version.js';
import type { ExecutionPlan } from '../types/execution-plan.js';

export const versionCommand = new Command('version')
  .description('Plan version management');

versionCommand
  .command('save')
  .description('Save a new plan version')
  .argument('<plan_file>', 'path to plan JSON file')
  .option('-m, --message <msg>', 'change description', 'No description')
  .action((planFile: string, opts) => {
    try {
      const filePath = resolve(planFile);
      if (!existsSync(filePath)) {
        console.error(chalk.red(`File not found: ${filePath}`));
        process.exit(1);
      }
      const plan = JSON.parse(readFileSync(filePath, 'utf8')) as ExecutionPlan;
      const version = createPlanVersion(plan, opts.message);
      console.log(`Saved: ${plan.plan_id} v${version.version}`);
      for (const c of version.changes) {
        const prefix = c.type.includes('added') ? '+' : c.type.includes('removed') ? '-' : '~';
        console.log(`  ${prefix} ${c.detail}`);
      }
    } catch (err: unknown) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

versionCommand
  .command('history')
  .description('Show version history for a plan')
  .argument('<plan_id>', 'plan ID')
  .action((planId: string) => {
    const history = loadPlanHistory(planId);
    if (history.versions.length === 0) {
      console.log('No versions found.');
      return;
    }
    console.log(formatPlanHistory(history));
  });

versionCommand
  .command('show')
  .description('Show a specific plan version')
  .argument('<plan_id>', 'plan ID')
  .argument('<version>', 'version number')
  .option('--json', 'output full plan as JSON')
  .action((planId: string, version: string, opts: { json?: boolean }) => {
    const v = loadPlanVersion(planId, parseInt(version, 10));
    if (!v) {
      console.error(chalk.red(`Version not found: ${planId} v${version}`));
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(v.plan, null, 2));
    } else {
      console.log(`v${v.version}  ${v.createdAt.slice(0, 19)}  ${v.changeDescription}`);
      console.log(`  Hash: ${v.planHash}`);
      console.log(`  Steps: ${v.plan.steps.length}`);
      for (const c of v.changes) {
        const prefix = c.type.includes('added') ? '+' : c.type.includes('removed') ? '-' : '~';
        console.log(`  ${prefix} ${c.detail}`);
      }
    }
  });

versionCommand
  .command('diff')
  .description('Compare two plan versions')
  .argument('<plan_id>', 'plan ID')
  .argument('<v1>', 'first version number')
  .argument('<v2>', 'second version number')
  .action((planId: string, v1: string, v2: string) => {
    const version1 = loadPlanVersion(planId, parseInt(v1, 10));
    const version2 = loadPlanVersion(planId, parseInt(v2, 10));

    if (!version1 || !version2) {
      console.error(chalk.red('One or both versions not found'));
      process.exit(1);
    }

    const changes = computeSemanticDiff(version1.plan, version2.plan);

    console.log(`Diff: v${v1} → v${v2}`);
    if (changes.length === 0) {
      console.log('  No changes.');
    } else {
      for (const c of changes) {
        const prefix = c.type.includes('added') ? '+' : c.type.includes('removed') ? '-' : '~';
        console.log(`  ${prefix} ${c.detail}`);
        if (c.from !== undefined) console.log(`    from: ${c.from}`);
        if (c.to !== undefined) console.log(`    to:   ${c.to}`);
      }
    }
  });
