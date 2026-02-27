import { Command } from 'commander';
import { computeMetrics, formatMetrics } from '../core/metrics.js';

export const metricsCommand = new Command('metrics')
  .description('Show aggregate metrics across all runs (success rate, duration, cost, trends)')
  .option('--since <date>', 'only include runs after this ISO date')
  .option('--until <date>', 'only include runs before this ISO date')
  .option('--source <source>', 'filter by plan source: llm, cache, file')
  .option('--json', 'output as JSON', false)
  .action((opts) => {
    const metrics = computeMetrics({
      since: opts.since,
      until: opts.until,
      planSource: opts.source,
    });

    if (opts.json) {
      console.log(JSON.stringify(metrics, null, 2));
    } else {
      console.log(formatMetrics(metrics));
    }
  });
