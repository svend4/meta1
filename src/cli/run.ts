import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { run } from '../core/runner.js';
import { analyzePlan } from '../core/dry-run.js';
import { loadConfig } from '../core/config.js';
import { watchDirectory } from '../core/watcher.js';
import { LocalSandbox } from '../sandbox/local.js';
import { getDefaultWorkspace } from '../core/paths.js';
import type { TaskSpec } from '../types/task-spec.js';

export const runCommand = new Command('run')
  .description('Plan and execute a task via LLM (or cache hit)')
  .argument('<prompt>', 'Task description in natural language')
  .option('--model <model>', 'LLM model to use')
  .option('--workspace <dir>', 'Output directory')
  .option('--no-cache', 'Force LLM call even if cache exists')
  .option('--cache-only', 'Fail if no cached plan (never call LLM)')
  .option('--dry-run', 'Preview execution plan without running')
  .option('--watch <glob>', 'Re-run on file changes matching glob')
  .option('--config <path>', 'Config file path')
  .option('--json', 'Output result as JSON (for CI pipelines)')
  .action(async (prompt: string, opts: {
    model?: string;
    workspace?: string;
    cache: boolean;
    cacheOnly?: boolean;
    dryRun?: boolean;
    watch?: string;
    config?: string;
    json?: boolean;
  }) => {
    const config = loadConfig(opts.config);
    const model = opts.model ?? config.model;
    const taskId = randomUUID();
    const workspace = opts.workspace
      ? resolve(opts.workspace)
      : config.workspace_dir
        ? resolve(config.workspace_dir, taskId)
        : getDefaultWorkspace(taskId);

    const task: TaskSpec = {
      task_id: taskId,
      prompt,
      model,
    };

    // Dry-run mode: generate plan then analyze without executing
    if (opts.dryRun) {
      try {
        const { generatePlan } = await import('../core/planner.js');
        const { lookupPlan } = await import('../core/plan-cache.js');
        const { SYSTEM_PROMPT_HASH } = await import('../core/planner.js');

        let plan;
        if (opts.cache !== false) {
          const cached = lookupPlan({
            prompt: task.prompt,
            context: task.context,
            model: task.model,
            systemPromptHash: SYSTEM_PROMPT_HASH,
          });
          if (cached.hit) {
            plan = cached.plan;
          }
        }

        if (!plan) {
          if (opts.cacheOnly) {
            console.error(chalk.red('No cached plan found for dry-run'));
            process.exit(1);
          }
          plan = await generatePlan(task);
        }

        const result = analyzePlan(plan);

        if (opts.json) {
          console.log(JSON.stringify({ dry_run: true, ...result }, null, 2));
          process.exit(result.valid ? 0 : 1);
        }

        console.log(chalk.blue('Dry Run Analysis'));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.gray(`Plan ID:    ${result.plan_id}`));
        console.log(chalk.gray(`Mode:       ${result.execution_mode}`));
        console.log(chalk.gray(`Steps:      ${result.total_steps} (${result.files_created} files, ${result.commands_run} commands)`));
        console.log(chalk.gray(`Layers:     ${result.layers}`));
        if (result.assertions_count > 0) {
          console.log(chalk.gray(`Assertions: ${result.assertions_count}`));
        }
        console.log();

        for (const step of result.steps) {
          const icon = step.type === 'create_file' ? chalk.green('F') : chalk.yellow('C');
          const det = step.determinism === 'best_effort' ? chalk.yellow(' [best_effort]') : '';
          console.log(`  L${step.layer} ${icon} ${step.step_id}${det}`);
          console.log(chalk.gray(`     ${step.description}`));
        }

        for (const warn of result.warnings) {
          console.log(chalk.yellow(`\nWarning: ${warn}`));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Dry run failed: ${msg}`));
        process.exit(1);
      }
      return;
    }

    // Watch mode
    if (opts.watch) {
      const ac = new AbortController();
      process.on('SIGINT', () => {
        console.log(chalk.gray('\nStopping watch...'));
        ac.abort();
        process.exit(0);
      });

      console.log(chalk.blue('Continuum Watch'));
      console.log(chalk.gray(`Pattern:   ${opts.watch}`));
      console.log(chalk.gray(`Task:      ${prompt}`));
      console.log(chalk.gray(`Workspace: ${workspace}`));
      console.log(chalk.gray('Waiting for changes...\n'));

      watchDirectory(process.cwd(), {
        glob: opts.watch,
        debounceMs: 500,
        signal: ac.signal,
        onTrigger: async () => {
          console.log(chalk.gray(`\n${'─'.repeat(50)}`));
          console.log(chalk.blue(`Re-running at ${new Date().toISOString()}`));

          const runWorkspace = getDefaultWorkspace(randomUUID());
          const sandbox = new LocalSandbox(runWorkspace);
          try {
            const summary = await run(task, sandbox, {
              workspace: runWorkspace,
              useCache: opts.cache,
              cacheOnly: opts.cacheOnly,
            });

            if (summary.status === 'completed' || summary.status === 'verified') {
              console.log(chalk.green(`Completed (${summary.duration_ms}ms)`));
            } else {
              console.log(chalk.red(`Failed: ${summary.steps.find((s) => s.status === 'failed')?.error}`));
            }
          } catch (err: unknown) {
            console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
          }
          console.log(chalk.gray('Waiting for changes...'));
        },
      });

      // Keep alive
      await new Promise(() => {});
      return;
    }

    // Normal execution
    const sandbox = new LocalSandbox(workspace);

    try {
      if (!opts.json) {
        console.log(chalk.blue('Continuum Run'));
        console.log(chalk.gray(`Task:      ${prompt}`));
        console.log(chalk.gray(`Model:     ${model}`));
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
