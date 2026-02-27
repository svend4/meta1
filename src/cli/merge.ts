import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { mergePlans, formatMergeResult } from '../core/plan-merge.js';
import type { ExecutionPlan } from '../types/execution-plan.js';
import type { ConflictStrategy } from '../core/plan-merge.js';

export const mergeCommand = new Command('merge')
  .description('Three-way merge of execution plans')
  .argument('<base>', 'base plan file')
  .argument('<ours>', 'our plan file')
  .argument('<theirs>', 'their plan file')
  .option('-s, --strategy <strategy>', 'conflict strategy: ours, theirs, fail', 'fail')
  .option('-o, --output <file>', 'write merged plan to file')
  .option('--json', 'output as JSON')
  .action((basePath: string, oursPath: string, theirsPath: string, opts) => {
    try {
      const load = (p: string): ExecutionPlan => {
        const abs = resolve(p);
        if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);
        return JSON.parse(readFileSync(abs, 'utf8'));
      };

      const base = load(basePath);
      const ours = load(oursPath);
      const theirs = load(theirsPath);

      const result = mergePlans(base, ours, theirs, {
        strategy: opts.strategy as ConflictStrategy,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatMergeResult(result));
      }

      if (result.plan && opts.output) {
        writeFileSync(opts.output, JSON.stringify(result.plan, null, 2), 'utf8');
        console.log(`\nMerged plan written to ${opts.output}`);
      }

      if (!result.success) process.exit(1);
    } catch (err: unknown) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });
