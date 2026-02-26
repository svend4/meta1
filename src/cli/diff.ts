import { Command } from 'commander';
import chalk from 'chalk';
import { loadRunSummary } from '../storage/runs.js';

export const diffCommand = new Command('diff')
  .description('Compare artifact hashes between two runs')
  .argument('<run_id_1>', 'First run ID')
  .argument('<run_id_2>', 'Second run ID')
  .action((id1: string, id2: string) => {
    try {
      const run1 = loadRunSummary(id1);
      const run2 = loadRunSummary(id2);

      console.log(chalk.blue('Run Diff'));
      console.log(chalk.gray('══════════════════════════════════════'));
      console.log(`A: ${run1.run_id}`);
      console.log(`B: ${run2.run_id}`);
      console.log();

      // Compare plan hashes
      if (run1.plan_hash === run2.plan_hash) {
        console.log(chalk.green('Plans: identical'));
      } else {
        console.log(chalk.red('Plans: different'));
        console.log(chalk.gray(`  A: ${run1.plan_hash}`));
        console.log(chalk.gray(`  B: ${run2.plan_hash}`));
      }

      // Compare run hashes
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

      // Build maps for step lookup
      const stepsA = new Map(run1.steps.map((s) => [s.step_id, s]));
      const stepsB = new Map(run2.steps.map((s) => [s.step_id, s]));
      const allStepIds = new Set([...stepsA.keys(), ...stepsB.keys()]);

      let matches = 0;
      let mismatches = 0;
      let missing = 0;

      for (const stepId of allStepIds) {
        const a = stepsA.get(stepId);
        const b = stepsB.get(stepId);

        if (!a || !b) {
          console.log(chalk.yellow(`  ~ ${stepId}: only in ${a ? 'A' : 'B'}`));
          missing++;
          continue;
        }

        if (!a.artifact_hash || !b.artifact_hash) {
          console.log(chalk.gray(`  ? ${stepId}: no hash (status: A=${a.status}, B=${b.status})`));
          continue;
        }

        if (a.artifact_hash === b.artifact_hash) {
          console.log(chalk.green(`  = ${stepId}`));
          matches++;
        } else {
          console.log(chalk.red(`  ! ${stepId}:`));
          console.log(chalk.gray(`    A: ${a.artifact_hash}`));
          console.log(chalk.gray(`    B: ${b.artifact_hash}`));
          mismatches++;
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
