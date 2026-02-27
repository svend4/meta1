import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { estimatePlanCost, formatCostEstimate } from '../core/cost-estimator.js';
import { loadGenerationPlan } from '../core/lineage.js';
import type { ExecutionPlan } from '../types/execution-plan.js';

export const estimateCommand = new Command('estimate')
  .description('Estimate plan execution cost and time')
  .argument('<source>', 'plan file path or hash (sha256:...)')
  .option('--json', 'output as JSON')
  .action((source: string, opts: { json?: boolean }) => {
    try {
      let plan: ExecutionPlan;

      if (source.startsWith('sha256:') || (/^[a-f0-9]{64}$/i).test(source)) {
        const hash: `sha256:${string}` = source.startsWith('sha256:')
          ? source as `sha256:${string}`
          : `sha256:${source}` as `sha256:${string}`;
        const loaded = loadGenerationPlan(hash);
        if (!loaded) {
          console.error(chalk.red(`Plan not found: ${hash}`));
          process.exit(1);
        }
        plan = loaded;
      } else {
        const filePath = resolve(source);
        if (!existsSync(filePath)) {
          console.error(chalk.red(`File not found: ${filePath}`));
          process.exit(1);
        }
        plan = JSON.parse(readFileSync(filePath, 'utf8'));
      }

      const estimate = estimatePlanCost(plan);

      if (opts.json) {
        console.log(JSON.stringify(estimate, null, 2));
      } else {
        console.log(formatCostEstimate(estimate));
      }
    } catch (err: unknown) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });
