import { Command } from 'commander';
import chalk from 'chalk';
import { loadRunSummary } from '../storage/runs.js';

export const explainCommand = new Command('explain')
  .description('Show a human-readable run summary with assertions and drift info (v3.0)')
  .argument('<run_id>', 'ID of the run to explain')
  .action((runId: string) => {
    try {
      const summary = loadRunSummary(runId);

      let statusLabel: string;
      switch (summary.status) {
        case 'completed': statusLabel = chalk.green('COMPLETED'); break;
        case 'verified': statusLabel = chalk.green('VERIFIED ✅'); break;
        case 'failed': statusLabel = chalk.red('FAILED'); break;
        case 'assertion_failed': statusLabel = chalk.red('ASSERTION FAILED'); break;
        case 'benign_drift': statusLabel = chalk.cyan('BENIGN DRIFT'); break;
        case 'healed': statusLabel = chalk.green('HEALED ✅'); break;
        default: statusLabel = chalk.gray(summary.status);
      }

      console.log();
      console.log(`${statusLabel}  ${summary.prompt}`);
      console.log(chalk.gray(`Run ${summary.run_id}`));
      console.log();

      const completed = summary.steps.filter((s) => s.status === 'completed').length;
      const failed = summary.steps.filter((s) => s.status === 'failed').length;
      const skipped = summary.steps.filter((s) => s.status === 'skipped').length;

      console.log(`Plan had ${summary.plan.steps.length} steps (source: ${summary.plan_source})`);
      console.log(`  ${chalk.green(`${completed} completed`)}${failed ? `, ${chalk.red(`${failed} failed`)}` : ''}${skipped ? `, ${chalk.yellow(`${skipped} skipped`)}` : ''}`);

      if (summary.duration_ms != null) {
        console.log(`Total time: ${summary.duration_ms}ms`);
      }

      console.log();
      console.log('Steps:');
      for (let i = 0; i < summary.steps.length; i++) {
        const step = summary.steps[i];
        const num = `${i + 1}.`;
        const det = step.determinism === 'guaranteed' ? chalk.cyan('[G]') : chalk.yellow('[B]');

        if (step.status === 'completed') {
          console.log(`  ${chalk.green(num)} ${det} ${step.description ?? step.step_id}`);
        } else if (step.status === 'failed') {
          console.log(`  ${chalk.red(num)} ${det} ${step.description ?? step.step_id}`);
          console.log(chalk.red(`     Error: ${step.error}`));
        } else {
          console.log(`  ${chalk.yellow(num)} ${det} ${step.description ?? step.step_id} ${chalk.yellow('(skipped)')}`);
        }
      }

      // v3.0: Show assertions
      if (summary.assertion_results && summary.assertion_results.length > 0) {
        console.log();
        console.log(`Assertions: ${summary.assertions_passed ?? 0}/${summary.assertions_total ?? 0}`);
        for (const r of summary.assertion_results) {
          const icon = r.passed ? chalk.green('✅') : chalk.red('❌');
          const stability = chalk.gray(`[${r.stability}]`);
          const attempts = r.attempts > 1 ? chalk.gray(` (${r.attempts} attempts)`) : '';
          console.log(`  ${icon} ${stability} ${r.assertion_id}: ${r.type}${attempts}`);
          if (!r.passed) {
            console.log(chalk.red(`     expected: ${r.expected}`));
            console.log(chalk.red(`     actual:   ${r.actual}`));
            if (r.diff) {
              console.log(chalk.gray(`     diff: ${r.diff.slice(0, 200)}`));
            }
          }
        }
      }

      // v3.0: Show fingerprint
      if (summary.dependency_fingerprint) {
        const fp = summary.dependency_fingerprint;
        console.log();
        console.log(chalk.gray(`Fingerprint: ${fp.fingerprint_hash.slice(0, 19)}...`));
        console.log(chalk.gray(`  node: ${fp.tools.node}, npm: ${fp.tools.npm}`));
        if (fp.lockfile) {
          console.log(chalk.gray(`  lockfile: ${fp.lockfile.path} (${fp.lockfile.hash.slice(0, 19)}...)`));
        }
      }

      if (summary.run_hash) {
        console.log();
        console.log(chalk.gray(`Run hash: ${summary.run_hash}`));
      }
      console.log();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(msg));
      process.exit(1);
    }
  });
