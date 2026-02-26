import { Command } from 'commander';
import chalk from 'chalk';
import { listRunSummaries } from '../storage/runs.js';

export const listCommand = new Command('list')
  .description('List all runs')
  .option('--json', 'Output as JSON')
  .action((opts: { json?: boolean }) => {
    const summaries = listRunSummaries();

    if (opts.json) {
      console.log(JSON.stringify(summaries.map((s) => ({
        run_id: s.run_id,
        prompt: s.prompt,
        status: s.status,
        plan_source: s.plan_source,
        started_at: s.started_at,
        duration_ms: s.duration_ms,
        steps: s.steps.length,
        run_hash: s.run_hash,
      })), null, 2));
      return;
    }

    if (summaries.length === 0) {
      console.log(chalk.gray('No runs found.'));
      return;
    }

    console.log(chalk.blue(`Runs (${summaries.length}):`));
    console.log();

    for (const s of summaries) {
      const status = s.status === 'completed'
        ? chalk.green('OK')
        : chalk.red('FAIL');
      const duration = s.duration_ms != null ? `${s.duration_ms}ms` : '?';
      const steps = `${s.steps.length} steps`;

      console.log(`  [${status}] ${s.run_id}`);
      console.log(chalk.gray(`       ${s.prompt}`));
      console.log(chalk.gray(`       ${s.plan_source} | ${steps} | ${duration} | ${s.started_at}`));
      console.log();
    }
  });
