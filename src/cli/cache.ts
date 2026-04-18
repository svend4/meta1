import { Command } from 'commander';
import chalk from 'chalk';
import { clearCache, clearExpired, getCacheStats } from '../core/plan-cache.js';

/** Parse a duration string like "7d", "24h", "30m" to milliseconds */
function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(d|h|m)$/);
  if (!match) {
    throw new Error(`Invalid duration format: "${input}". Use format like 7d, 24h, or 30m`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'm': return value * 60 * 1000;
    default: throw new Error(`Unknown duration unit: ${unit}`);
  }
}

function formatAge(ms: number): string {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const cacheCommand = new Command('cache')
  .description('Manage the plan cache');

cacheCommand
  .command('clear')
  .description('Clear cached plans (all or expired)')
  .option('--older-than <duration>', 'Only clear plans older than duration (e.g., 7d, 24h, 30m)')
  .action(async (opts: { olderThan?: string }) => {
    try {
      if (opts.olderThan) {
        const ttlMs = parseDuration(opts.olderThan);
        const count = clearExpired(ttlMs);
        if (count === 0) {
          console.log(`No cached plans older than ${opts.olderThan}.`);
        } else {
          console.log(`Cleared ${count} expired plan${count === 1 ? '' : 's'} (older than ${opts.olderThan}).`);
        }
      } else {
        const count = clearCache();
        if (count === 0) {
          console.log('Plan cache is already empty.');
        } else {
          console.log(`Cleared ${count} cached plan${count === 1 ? '' : 's'}.`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
      process.exit(1);
    }
  });

cacheCommand
  .command('stats')
  .description('Show plan cache statistics')
  .action(async () => {
    const stats = getCacheStats();
    if (stats.entries === 0) {
      console.log('Plan cache is empty.');
      return;
    }
    console.log(chalk.blue('Plan Cache Statistics'));
    console.log(chalk.gray(`  Entries:   ${stats.entries}`));
    console.log(chalk.gray(`  Size:      ${formatBytes(stats.totalBytes)}`));
    console.log(chalk.gray(`  Oldest:    ${formatAge(stats.oldestAgeMs)} ago`));
  });
