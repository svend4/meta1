import { Command } from 'commander';
import chalk from 'chalk';
import { loadRunSummary } from '../storage/runs.js';
import { diffForensics } from '../core/forensics-diff.js';

export const diffCommand = new Command('diff')
  .description('Compare two runs (artifacts or forensics)');

diffCommand
  .command('runs')
  .description('Compare artifact hashes between two runs')
  .argument('<run_id_1>', 'First run ID')
  .argument('<run_id_2>', 'Second run ID')
  .option('--json', 'Output as JSON')
  .action((id1: string, id2: string, opts: { json?: boolean }) => {
    try {
      const run1 = loadRunSummary(id1);
      const run2 = loadRunSummary(id2);

      // Build maps for step lookup
      const stepsA = new Map(run1.steps.map((s) => [s.step_id, s]));
      const stepsB = new Map(run2.steps.map((s) => [s.step_id, s]));
      const allStepIds = new Set([...stepsA.keys(), ...stepsB.keys()]);

      let matches = 0;
      let mismatches = 0;
      let missing = 0;
      const stepComparisons: Array<{
        step_id: string;
        status: 'match' | 'diverged' | 'missing';
        hash_a?: string;
        hash_b?: string;
        only_in?: string;
      }> = [];

      for (const stepId of allStepIds) {
        const a = stepsA.get(stepId);
        const b = stepsB.get(stepId);

        if (!a || !b) {
          stepComparisons.push({ step_id: stepId, status: 'missing', only_in: a ? 'a' : 'b' });
          missing++;
          continue;
        }

        if (!a.artifact_hash || !b.artifact_hash) {
          stepComparisons.push({ step_id: stepId, status: 'missing' });
          continue;
        }

        if (a.artifact_hash === b.artifact_hash) {
          stepComparisons.push({ step_id: stepId, status: 'match', hash_a: a.artifact_hash, hash_b: b.artifact_hash });
          matches++;
        } else {
          stepComparisons.push({ step_id: stepId, status: 'diverged', hash_a: a.artifact_hash, hash_b: b.artifact_hash });
          mismatches++;
        }
      }

      if (opts.json) {
        console.log(JSON.stringify({
          run_a: id1,
          run_b: id2,
          plans_identical: run1.plan_hash === run2.plan_hash,
          run_hashes_identical: run1.run_hash && run2.run_hash ? run1.run_hash === run2.run_hash : null,
          steps: stepComparisons,
          summary: { matches, diverged: mismatches, missing },
        }, null, 2));
        return;
      }

      console.log(chalk.blue('Run Diff'));
      console.log(chalk.gray('══════════════════════════════════════'));
      console.log(`A: ${run1.run_id}`);
      console.log(`B: ${run2.run_id}`);
      console.log();

      if (run1.plan_hash === run2.plan_hash) {
        console.log(chalk.green('Plans: identical'));
      } else {
        console.log(chalk.red('Plans: different'));
        console.log(chalk.gray(`  A: ${run1.plan_hash}`));
        console.log(chalk.gray(`  B: ${run2.plan_hash}`));
      }

      if (run1.run_hash && run2.run_hash) {
        if (run1.run_hash === run2.run_hash) {
          console.log(chalk.green('Run hashes: identical'));
        } else {
          console.log(chalk.red('Run hashes: different'));
          console.log(chalk.gray(`  A: ${run1.run_hash}`));
          console.log(chalk.gray(`  B: ${run2.run_hash}`));
        }
      }

      console.log();
      console.log(chalk.blue('Step-by-step comparison:'));

      for (const comp of stepComparisons) {
        if (comp.status === 'match') {
          console.log(chalk.green(`  = ${comp.step_id}`));
        } else if (comp.status === 'diverged') {
          console.log(chalk.red(`  ! ${comp.step_id}:`));
          console.log(chalk.gray(`    A: ${comp.hash_a}`));
          console.log(chalk.gray(`    B: ${comp.hash_b}`));
        } else if (comp.only_in) {
          console.log(chalk.yellow(`  ~ ${comp.step_id}: only in ${comp.only_in === 'a' ? 'A' : 'B'}`));
        } else {
          console.log(chalk.gray(`  ? ${comp.step_id}: no hash`));
        }
      }

      console.log();
      console.log(`${chalk.green(`${matches} matching`)}, ${chalk.red(`${mismatches} diverged`)}${missing ? `, ${chalk.yellow(`${missing} missing`)}` : ''}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(msg));
      process.exit(1);
    }
  });

diffCommand
  .command('forensics')
  .description('Compare forensics data between two runs')
  .argument('<run_id_1>', 'First run ID')
  .argument('<run_id_2>', 'Second run ID')
  .option('--json', 'Output as JSON')
  .action((id1: string, id2: string, opts: { json?: boolean }) => {
    try {
      const result = diffForensics(id1, id2);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(chalk.blue('Forensics Diff'));
      console.log(chalk.gray('══════════════════════════════════════'));
      console.log(`A: ${id1}`);
      console.log(`B: ${id2}`);
      console.log();

      if (result.steps.length === 0) {
        console.log(chalk.yellow('No forensics data available for either run.'));
        console.log(chalk.gray('Hint: use --forensics flag when running replay'));
        return;
      }

      console.log(chalk.blue('Step comparison:'));
      for (const step of result.steps) {
        const httpDelta = step.http_calls.b - step.http_calls.a;
        const fsDelta = step.fs_operations.b - step.fs_operations.a;
        const hasChanges = httpDelta !== 0 || fsDelta !== 0 || step.new_errors.length > 0 || step.resolved_errors.length > 0;

        if (!hasChanges) {
          console.log(chalk.green(`  = ${step.step_id}`));
          continue;
        }

        console.log(chalk.yellow(`  ~ ${step.step_id}:`));
        if (httpDelta !== 0) {
          console.log(chalk.gray(`    HTTP calls: ${step.http_calls.a} → ${step.http_calls.b} (${httpDelta > 0 ? '+' : ''}${httpDelta})`));
        }
        if (fsDelta !== 0) {
          console.log(chalk.gray(`    FS ops:     ${step.fs_operations.a} → ${step.fs_operations.b} (${fsDelta > 0 ? '+' : ''}${fsDelta})`));
        }
        for (const err of step.new_errors) {
          console.log(chalk.red(`    + ERROR: ${err}`));
        }
        for (const err of step.resolved_errors) {
          console.log(chalk.green(`    - resolved: ${err}`));
        }
      }

      if (result.http_diff.length > 0) {
        console.log();
        console.log(chalk.blue('HTTP call differences:'));
        for (const diff of result.http_diff) {
          const label = diff.only_in === 'a' ? chalk.red('- (A only)') : chalk.green('+ (B only)');
          console.log(`  ${label} ${diff.method} ${diff.url} [${diff.status ?? '?'}] ${diff.duration_ms ?? '?'}ms`);
        }
      }

      console.log();
      console.log(`${chalk.gray(`Steps changed: ${result.summary.steps_changed}`)}`);
      console.log(`${chalk.gray(`HTTP delta: ${result.summary.http_calls_delta > 0 ? '+' : ''}${result.summary.http_calls_delta}`)}`);
      console.log(`${chalk.gray(`FS delta: ${result.summary.fs_ops_delta > 0 ? '+' : ''}${result.summary.fs_ops_delta}`)}`);
      if (result.summary.new_errors > 0) console.log(chalk.red(`New errors: ${result.summary.new_errors}`));
      if (result.summary.resolved_errors > 0) console.log(chalk.green(`Resolved: ${result.summary.resolved_errors}`));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(msg));
      process.exit(1);
    }
  });
