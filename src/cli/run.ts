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
  .option('--json', 'Output result as JSON (for CI pipelines)')
  .action(async (prompt: string, opts: {
    model: string;
    workspace?: string;
    cache: boolean;
    cacheOnly?: boolean;
    json?: boolean;
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
      if (!opts.json) {
        console.log(chalk.blue('Continuum Run'));
        console.log(chalk.gray(`Task:      ${prompt}`));
        console.log(chalk.gray(`Model:     ${opts.model}`));
        console.log(chalk.gray(`Workspace: ${workspace}`));
        console.log();
      }

      const summary = await run(task, sandbox, {
        workspace,
        useCache: opts.cache,
        cacheOnly: opts.cacheOnly,
      });

      if (opts.json) {
        const output = {
          status: summary.status,
          run_id: summary.run_id,
          plan_hash: summary.plan_hash,
          run_hash: summary.run_hash,
          plan_source: summary.plan_source,
          steps: summary.steps.length,
          duration_ms: summary.duration_ms,
          assertions_passed: summary.assertions_passed,
          assertions_total: summary.assertions_total,
          error: summary.steps.find((s) => s.status === 'failed')?.error,
        };
        console.log(JSON.stringify(output, null, 2));
        if (summary.status === 'failed') process.exit(1);
        return;
      }

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
      if (opts.json) {
        console.log(JSON.stringify({ status: 'error', error: msg }));
      } else {
        console.error(chalk.red(`Fatal: ${msg}`));
      }
      process.exit(1);
    }
  });
