import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { loadGenerationPlan } from '../core/lineage.js';
import { deepValidatePlan, formatDeepValidation } from '../core/deep-validate.js';
import type { ExecutionPlan } from '../types/execution-plan.js';

export const deepValidateCommand = new Command('deep-validate')
  .description('Deep semantic validation of a plan (cycles, conflicts, reachability)')
  .argument('<source>', 'Plan hash (sha256:...) or path to plan JSON file')
  .option('--json', 'Output as JSON')
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

      const report = deepValidatePlan(plan);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatDeepValidation(report));
      }

      if (!report.passed) process.exit(1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(msg));
      process.exit(1);
    }
  });
