import { Command } from 'commander';
import { clearCache } from '../core/plan-cache.js';

export const cacheCommand = new Command('cache')
  .description('Manage the plan cache');

cacheCommand
  .command('clear')
  .description('Clear all cached plans')
  .action(async () => {
    const count = clearCache();
    if (count === 0) {
      console.log('Plan cache is already empty.');
    } else {
      console.log(`Cleared ${count} cached plan${count === 1 ? '' : 's'}.`);
    }
  });
