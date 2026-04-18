import { Command } from 'commander';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { loadGenerationPlan } from '../core/lineage.js';
import { optimizePlan, formatOptimization } from '../core/plan-optimizer.js';
import type { ExecutionPlan } from '../types/execution-plan.js';

export const optimizeCommand = new Command('optimize')
  .description('Optimize a plan for better parallelism')
  .argument('<source>', 'Plan hash (sha256:...) or path to plan JSON file')
  .option('-o, --output <file>', 'write optimized plan to file')
  .option('--json', 'output result as JSON')
  .option('--dry-run', 'show optimizations without applying', false)
  .action((source: string, opts: { output?: string; json?: boolean; dryRun?: boolean }) => {
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

      const result = optimizePlan(plan);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatOptimization(result));
      }

      if (opts.output && !opts.dryRun) {
        writeFileSync(opts.output, JSON.stringify(result.plan, null, 2), 'utf8');
        console.log(`\nOptimized plan written to ${opts.output}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(msg));
      process.exit(1);
    }
  });
