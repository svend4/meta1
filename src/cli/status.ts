import { Command } from 'commander';
import { getSystemStatus, formatStatus } from '../core/status.js';

export const statusCommand = new Command('status')
  .description('Show system status overview')
  .option('--json', 'output as JSON', false)
  .action((opts) => {
    const status = getSystemStatus();

    if (opts.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(formatStatus(status));
    }
  });
