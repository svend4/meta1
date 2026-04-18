import { Command } from 'commander';
import { loadRunSummary } from '../storage/runs.js';
import { compareRuns, formatComparison } from '../core/run-compare.js';

export const compareCommand = new Command('compare')
  .description('Compare two runs side-by-side')
  .argument('<run_id_a>', 'first run ID')
  .argument('<run_id_b>', 'second run ID')
  .option('--json', 'output as JSON', false)
  .action((runIdA: string, runIdB: string, opts) => {
    try {
      const a = loadRunSummary(runIdA);
      const b = loadRunSummary(runIdB);
      const comparison = compareRuns(a, b);

      if (opts.json) {
        console.log(JSON.stringify(comparison, null, 2));
      } else {
        console.log(formatComparison(comparison));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });
