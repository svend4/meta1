import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { assertValidPlan } from '../core/validator.js';
import { lintPlan, formatLintResult } from '../core/lint.js';
import type { ExecutionPlan } from '../types/execution-plan.js';

export const lintCommand = new Command('lint')
  .description('Lint a plan for common mistakes and safety issues')
  .argument('<plan-file>', 'path to plan JSON file')
  .option('--json', 'output as JSON', false)
  .option('--strict', 'treat warnings as errors', false)
  .action((planFile: string, opts) => {
    try {
      const raw = JSON.parse(readFileSync(planFile, 'utf8'));
      assertValidPlan(raw);
      const plan = raw as ExecutionPlan;
      const result = lintPlan(plan);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatLintResult(result));
      }

      const exitCode = opts.strict
        ? (result.errors + result.warnings > 0 ? 1 : 0)
        : (result.errors > 0 ? 1 : 0);

      process.exit(exitCode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });
