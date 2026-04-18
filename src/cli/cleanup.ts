import { Command } from 'commander';
import chalk from 'chalk';
import { cleanup } from '../core/retention.js';
import { loadConfig } from '../core/config.js';

export const cleanupCommand = new Command('cleanup')
  .description('Clean up old runs, forensics, and cache entries')
  .option('--max-runs <n>', 'Keep only the latest N runs')
  .option('--max-age <days>', 'Remove runs older than N days')
  .option('--include-cache', 'Also clean expired cache entries')
  .option('--dry-run', 'Preview what would be removed without deleting')
  .option('--config <path>', 'Config file path')
  .option('--json', 'Output as JSON')
  .action((opts: {
    maxRuns?: string;
    maxAge?: string;
    includeCache?: boolean;
    dryRun?: boolean;
    config?: string;
    json?: boolean;
  }) => {
    try {
      const config = loadConfig(opts.config);

      const maxRuns = opts.maxRuns ? parseInt(opts.maxRuns, 10) : config.retention.max_runs;
      const maxAgeDays = opts.maxAge ? parseInt(opts.maxAge, 10) : config.retention.max_age_days;

      const { targets, result, cacheCleared } = cleanup({
        maxRuns,
        maxAgeDays,
        dryRun: opts.dryRun,
        includeCache: opts.includeCache,
      });

      if (opts.json) {
        console.log(JSON.stringify({
          dry_run: !!opts.dryRun,
          targets: targets.map((t) => ({
            type: t.type,
            id: t.id,
            age_days: t.age_days,
          })),
          removed: result?.removed.length ?? 0,
          errors: result?.errors ?? [],
          cache_cleared: cacheCleared,
        }, null, 2));
        return;
      }

      if (opts.dryRun) {
        console.log(chalk.blue('Cleanup Preview (dry-run)'));
        console.log(chalk.gray('─'.repeat(50)));
      } else {
        console.log(chalk.blue('Cleanup'));
        console.log(chalk.gray('─'.repeat(50)));
      }

      if (targets.length === 0) {
        console.log(chalk.green('Nothing to clean up.'));
      } else {
        for (const target of targets) {
          const icon = opts.dryRun ? chalk.yellow('~') : chalk.red('x');
          console.log(`  ${icon} ${target.type} ${chalk.gray(target.id)} (${target.age_days}d old)`);
        }
      }

      if (result) {
        console.log();
        console.log(chalk.green(`Removed: ${result.removed.length} run(s)`));
        if (result.errors.length > 0) {
          console.log(chalk.red(`Errors: ${result.errors.length}`));
          for (const e of result.errors) {
            console.log(chalk.red(`  ${e.id}: ${e.error}`));
          }
        }
      }

      if (cacheCleared !== undefined) {
        console.log(chalk.gray(`Cache: ${cacheCleared} expired entry/entries cleared`));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (opts.json) {
        console.log(JSON.stringify({ error: msg }));
      } else {
        console.error(chalk.red(msg));
      }
      process.exit(1);
    }
  });
