import { Command } from 'commander';
import chalk from 'chalk';
import { loadRunSummary } from '../storage/runs.js';

export const inspectCommand = new Command('inspect')
  .description('Show detailed run data (JSON-capable)')
  .argument('<run_id>', 'ID of the run to inspect')
  .option('--json', 'Output as JSON')
  .action((runId: string, opts: { json?: boolean }) => {
    try {
      const summary = loadRunSummary(runId);

      if (opts.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      console.log(chalk.blue('Run Inspection'));
      console.log(chalk.gray('══════════════════════════════════════'));
      console.log(`Run ID:      ${summary.run_id}`);
      console.log(`Task ID:     ${summary.task_id}`);
      console.log(`Status:      ${summary.status === 'completed' ? chalk.green(summary.status) : chalk.red(summary.status)}`);
      console.log(`Prompt:      ${summary.prompt}`);
      console.log(`Plan source: ${summary.plan_source}`);
      console.log(`Plan hash:   ${summary.plan_hash}`);
      if (summary.run_hash) console.log(`Run hash:    ${summary.run_hash}`);
      if (summary.cache_key) console.log(`Cache key:   ${summary.cache_key}`);
      console.log(`Started:     ${summary.started_at}`);
      if (summary.completed_at) console.log(`Completed:   ${summary.completed_at}`);
      if (summary.duration_ms != null) console.log(`Duration:    ${summary.duration_ms}ms`);
      if (summary.workspace) console.log(`Workspace:   ${summary.workspace}`);

      console.log();
      console.log(chalk.blue(`Steps (${summary.steps.length}):`));
      for (const step of summary.steps) {
        const icon = step.status === 'completed' ? chalk.green('OK') :
                     step.status === 'failed' ? chalk.red('FAIL') :
                     chalk.yellow('SKIP');
        console.log(`  [${icon}] ${step.step_id} (${step.type})`);
        if (step.description) console.log(chalk.gray(`       ${step.description}`));
        if (step.artifact_hash) console.log(chalk.gray(`       hash: ${step.artifact_hash}`));
        if (step.duration_ms != null) console.log(chalk.gray(`       ${step.duration_ms}ms`));
        if (step.error) console.log(chalk.red(`       error: ${step.error}`));
      }

      if (summary.plan.planner_signature) {
        const sig = summary.plan.planner_signature;
        console.log();
        console.log(chalk.blue('Planner Signature:'));
        console.log(`  Model:       ${sig.planner_model}`);
        if (sig.planner_version) console.log(`  Version:     ${sig.planner_version}`);
        console.log(`  Prompt hash: ${sig.system_prompt_hash}`);
        console.log(`  Generated:   ${sig.generated_at}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(msg));
      process.exit(1);
    }
  });
