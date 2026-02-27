import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { executeFromFile } from '../core/runner.js';
import { analyzePlan } from '../core/dry-run.js';
import { applyTemplate, extractVariables } from '../core/template.js';
import { LocalSandbox } from '../sandbox/local.js';
import { getDefaultWorkspace } from '../core/paths.js';

export const executeCommand = new Command('execute')
  .description('Execute an existing ExecutionPlan JSON without LLM involvement')
  .argument('<plan_file>', 'Path to plan JSON file')
  .option('--workspace <dir>', 'Output directory')
  .option('--dry-run', 'Preview execution without running')
  .option('--var <key=value...>', 'Template variable (repeatable)', collectExecuteVar, {})
  .option('--timeout <ms>', 'Default step timeout in ms', parseInt)
  .option('--json', 'Output as JSON')
  .action(async (planFile: string, opts: {
    workspace?: string;
    dryRun?: boolean;
    var: Record<string, string>;
    timeout?: number;
    json?: boolean;
  }) => {
    const planPath = resolve(planFile);
    const workspace = opts.workspace
      ? resolve(opts.workspace)
      : getDefaultWorkspace(randomUUID());

    if (opts.dryRun) {
      try {
        let plan = JSON.parse(readFileSync(planPath, 'utf8'));
        const vars = extractVariables(plan);
        if (vars.length > 0 || Object.keys(opts.var).length > 0) {
          plan = applyTemplate(plan, opts.var);
        }
        const result = analyzePlan(plan);

        if (opts.json) {
          console.log(JSON.stringify({ dry_run: true, ...result }, null, 2));
          process.exit(result.valid ? 0 : 1);
        }

        console.log(chalk.blue('Execute Dry Run'));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.gray(`Plan:   ${planPath}`));
        console.log(chalk.gray(`Steps:  ${result.total_steps}`));
        console.log(chalk.gray(`Layers: ${result.layers}`));
        console.log();

        for (const step of result.steps) {
          const icon = step.type === 'create_file' ? chalk.green('F') : chalk.yellow('C');
          console.log(`  L${step.layer} ${icon} ${step.step_id}`);
        }

        for (const warn of result.warnings) {
          console.log(chalk.yellow(`\nWarning: ${warn}`));
        }

        if (!result.valid) {
          for (const err of result.errors) {
            console.error(chalk.red(`Error: ${err}`));
          }
          process.exit(1);
        }
      } catch (err: unknown) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
      return;
    }

    const sandbox = new LocalSandbox(workspace);

    try {
      console.log(chalk.blue('Continuum Execute'));
      console.log(chalk.gray(`Plan:      ${planPath}`));
      console.log(chalk.gray(`Workspace: ${workspace}`));
      console.log();

      const summary = await executeFromFile(planPath, sandbox, { workspace });

      if (summary.status === 'completed') {
        console.log(chalk.green('Execution completed successfully.'));
        console.log(chalk.gray(`Run ID:    ${summary.run_id}`));
        console.log(chalk.gray(`Steps:     ${summary.steps.length}`));
        console.log(chalk.gray(`Duration:  ${summary.duration_ms}ms`));
        console.log(chalk.gray(`Run hash:  ${summary.run_hash}`));
      } else {
        const failedStep = summary.steps.find((s) => s.status === 'failed');
        console.error(chalk.red('Execution failed.'));
        console.error(chalk.gray(`Run ID:    ${summary.run_id}`));
        if (failedStep) {
          console.error(chalk.red(`Failed at: ${failedStep.step_id}`));
          console.error(chalk.red(`Error:     ${failedStep.error}`));
        }
        process.exit(1);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Fatal: ${msg}`));
      process.exit(1);
    }
  });

function collectExecuteVar(val: string, acc: Record<string, string>): Record<string, string> {
  const eq = val.indexOf('=');
  if (eq === -1) {
    throw new Error(`Invalid --var format: "${val}". Expected key=value`);
  }
  acc[val.slice(0, eq)] = val.slice(eq + 1);
  return acc;
}
