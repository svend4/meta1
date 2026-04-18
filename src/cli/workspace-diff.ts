import { Command } from 'commander';
import chalk from 'chalk';
import { diffWorkspaces, formatWorkspaceDiff } from '../core/workspace-diff.js';

export const workspaceDiffCommand = new Command('workspace-diff')
  .description('Compare file outputs between two runs')
  .argument('<run_a>', 'first run ID')
  .argument('<run_b>', 'second run ID')
  .option('--content', 'show content diffs', false)
  .option('--json', 'output as JSON')
  .action((runA: string, runB: string, opts: { content?: boolean; json?: boolean }) => {
    try {
      const diff = diffWorkspaces(runA, runB);

      if (opts.json) {
        console.log(JSON.stringify(diff, null, 2));
      } else {
        console.log(formatWorkspaceDiff(diff, { showContent: opts.content }));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(msg));
      process.exit(1);
    }
  });
