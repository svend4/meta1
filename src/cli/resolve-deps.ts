import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { resolveDependencies, validateDependencies, formatResolution } from '../core/dep-resolver.js';
import type { ExecutionPlan } from '../types/execution-plan.js';

export const resolveCommand = new Command('resolve-deps')
  .description('Auto-resolve step dependencies from implicit data flow')
  .argument('<plan_file>', 'plan file path')
  .option('-o, --output <file>', 'write resolved plan to file')
  .option('--validate', 'validate existing dependencies only')
  .option('--json', 'output as JSON')
  .action((planFile: string, opts) => {
    try {
      const abs = resolve(planFile);
      if (!existsSync(abs)) {
        console.error(chalk.red(`File not found: ${abs}`));
        process.exit(1);
      }

      const plan = JSON.parse(readFileSync(abs, 'utf8')) as ExecutionPlan;

      if (opts.validate) {
        const issues = validateDependencies(plan);
        if (issues.length === 0) {
          console.log('All dependencies valid.');
        } else {
          for (const issue of issues) {
            console.log(chalk.yellow(`  ${issue}`));
          }
          process.exit(1);
        }
        return;
      }

      const result = resolveDependencies(plan);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatResolution(result));
      }

      if (opts.output) {
        const resolved = { ...plan, steps: result.steps };
        writeFileSync(opts.output, JSON.stringify(resolved, null, 2), 'utf8');
        console.log(`\nResolved plan written to ${opts.output}`);
      }
    } catch (err: unknown) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });
