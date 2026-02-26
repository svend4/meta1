import { Command } from 'commander';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { getForensicsDir } from '../core/paths.js';

export const forensicsCommand = new Command('forensics')
  .description('Show recorded HTTP calls and FS events for a run (v3.0)')
  .argument('<run_id>', 'ID of the run to inspect')
  .option('--step <step_id>', 'Filter to a specific step')
  .action(async (runId: string, opts: { step?: string }) => {
    try {
      const forensicsDir = getForensicsDir(runId);

      if (!existsSync(forensicsDir)) {
        console.log(chalk.yellow('No forensics data found for this run.'));
        console.log(chalk.gray('Run with --forensics flag to record HTTP calls:'));
        console.log(chalk.gray(`  continuum replay ${runId} --heal --forensics`));
        return;
      }

      const httpDir = join(forensicsDir, 'http');
      if (!existsSync(httpDir)) {
        console.log(chalk.yellow('No HTTP forensics data recorded.'));
        return;
      }

      console.log(chalk.blue('Continuum Forensics'));
      console.log(chalk.gray(`Run: ${runId}`));
      console.log();

      const stepDirs = readdirSync(httpDir);
      const filteredSteps = opts.step
        ? stepDirs.filter((d) => d === opts.step)
        : stepDirs;

      if (filteredSteps.length === 0) {
        console.log(chalk.yellow(opts.step
          ? `No forensics data for step: ${opts.step}`
          : 'No step forensics data found.'
        ));
        return;
      }

      for (const stepDir of filteredSteps) {
        console.log(chalk.cyan(`Step: ${stepDir}`));
        const stepPath = join(httpDir, stepDir);
        const files = readdirSync(stepPath).filter((f) => f.endsWith('.json')).sort();

        for (const file of files) {
          try {
            const data = JSON.parse(readFileSync(join(stepPath, file), 'utf8'));
            const method = data.method ?? '???';
            const url = data.url ?? '???';
            const status = data.response?.status ?? '???';
            const duration = data.duration_ms ?? '?';

            console.log(chalk.gray(
              `  ${method} ${url} → ${status} (${duration}ms)`,
            ));
          } catch {
            console.log(chalk.gray(`  ${file}: (parse error)`));
          }
        }
        console.log();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
      process.exit(1);
    }
  });
