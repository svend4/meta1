import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { executeFromFile } from '../core/runner.js';
import { LocalSandbox } from '../sandbox/local.js';
import { getDefaultWorkspace } from '../core/paths.js';

export const executeCommand = new Command('execute')
  .description('Execute an existing ExecutionPlan JSON without LLM involvement')
  .argument('<plan_file>', 'Path to plan JSON file')
  .option('--workspace <dir>', 'Output directory')
  .action(async (planFile: string, opts: { workspace?: string }) => {
    const planPath = resolve(planFile);
    const workspace = opts.workspace
      ? resolve(opts.workspace)
      : getDefaultWorkspace(randomUUID());

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
