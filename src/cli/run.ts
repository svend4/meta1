import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { run } from '../core/runner.js';
import { LocalSandbox } from '../sandbox/local.js';
import { getDefaultWorkspace } from '../core/paths.js';
import type { TaskSpec } from '../types/task-spec.js';

export const runCommand = new Command('run')
  .description('Plan and execute a task via LLM (or cache hit)')
  .argument('<prompt>', 'Task description in natural language')
  .option('--model <model>', 'LLM model to use', 'claude-sonnet-4-20250514')
  .option('--workspace <dir>', 'Output directory')
  .option('--no-cache', 'Force LLM call even if cache exists')
  .option('--cache-only', 'Fail if no cached plan (never call LLM)')
  .action(async (prompt: string, opts: {
    model: string;
    workspace?: string;
    cache: boolean;
    cacheOnly?: boolean;
  }) => {
    const taskId = randomUUID();
    const workspace = opts.workspace
      ? resolve(opts.workspace)
      : getDefaultWorkspace(taskId);

    const task: TaskSpec = {
      task_id: taskId,
      prompt,
      model: opts.model,
    };

    const sandbox = new LocalSandbox(workspace);

    try {
      console.log(chalk.blue('Continuum Run'));
      console.log(chalk.gray(`Task:      ${prompt}`));
      console.log(chalk.gray(`Model:     ${opts.model}`));
      console.log(chalk.gray(`Workspace: ${workspace}`));
      console.log();

      const summary = await run(task, sandbox, {
        workspace,
        useCache: opts.cache,
        cacheOnly: opts.cacheOnly,
      });

      if (summary.status === 'completed') {
        console.log(chalk.green('Run completed successfully.'));
        console.log(chalk.gray(`Run ID:    ${summary.run_id}`));
        console.log(chalk.gray(`Plan:      ${summary.plan.steps.length} steps`));
        console.log(chalk.gray(`Source:    ${summary.plan_source}`));
        console.log(chalk.gray(`Duration:  ${summary.duration_ms}ms`));
        console.log(chalk.gray(`Run hash:  ${summary.run_hash}`));
      } else {
        const failedStep = summary.steps.find((s) => s.status === 'failed');
        console.error(chalk.red('Run failed.'));
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
