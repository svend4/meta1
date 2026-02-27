import { Command } from 'commander';
import { loadRunSummary } from '../storage/runs.js';
import { buildTimeline, formatTimeline } from '../core/timeline.js';

export const timelineCommand = new Command('timeline')
  .description('Show ASCII Gantt chart of a run\'s execution timeline')
  .argument('<run_id>', 'run ID to visualize')
  .option('-w, --width <n>', 'chart width in columns', '60')
  .option('--json', 'output as JSON', false)
  .action((runId: string, opts) => {
    try {
      const run = loadRunSummary(runId);
      const timeline = buildTimeline(run);

      if (opts.json) {
        console.log(JSON.stringify(timeline, null, 2));
      } else {
        console.log(formatTimeline(timeline, parseInt(opts.width, 10)));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });
