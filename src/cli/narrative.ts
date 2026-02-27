import { Command } from 'commander';
import chalk from 'chalk';
import { loadRunSummary } from '../storage/runs.js';
import { generateNarrative } from '../core/narrative.js';

export const narrativeCommand = new Command('narrative')
  .description('Generate a natural-language narrative of a run')
  .argument('<run_id>', 'ID of the run')
  .action((runId: string) => {
    try {
      const summary = loadRunSummary(runId);
      const story = generateNarrative(summary);
      console.log();
      console.log(story);
      console.log();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(msg));
      process.exit(1);
    }
  });
