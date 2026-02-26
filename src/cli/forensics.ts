import { Command } from 'commander';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { getForensicsDir } from '../core/paths.js';
import { loadForensicsSummary, loadHttpRecords } from '../core/forensics.js';

export const forensicsCommand = new Command('forensics')
  .description('Show recorded HTTP calls, FS events, and diagnostics for a run (v3.0)')
  .argument('<run_id>', 'ID of the run to inspect')
  .option('--step <step_id>', 'Filter to a specific step')
  .option('--summary', 'Show compact summary only')
  .option('--timeline', 'Show chronological timeline of all events')
  .option('--errors', 'Show only events with errors')
  .action(async (runId: string, opts: { step?: string; summary?: boolean; timeline?: boolean; errors?: boolean }) => {
    try {
      const forensicsDir = getForensicsDir(runId);

      if (!existsSync(forensicsDir)) {
        console.log(chalk.yellow('No forensics data found for this run.'));
        console.log(chalk.gray('Run with --forensics flag to record HTTP calls:'));
        console.log(chalk.gray(`  continuum replay ${runId} --heal --forensics`));
        return;
      }

      // Try loading the summary first
      const summary = loadForensicsSummary(runId);

      if (opts.summary) {
        if (!summary) {
          console.log(chalk.yellow('No forensics summary available. Run `continuum forensics <run_id>` without --summary to see raw data.'));
          return;
        }

        console.log(chalk.blue('Continuum Forensics Summary'));
        console.log(chalk.gray(`Run: ${runId}`));
        console.log(chalk.gray(`Generated: ${summary.generated_at}`));
        console.log();
        console.log(`  HTTP calls: ${chalk.cyan(String(summary.total_http_calls))}`);
        console.log(`  FS operations: ${chalk.cyan(String(summary.total_fs_operations))}`);
        console.log(`  Steps: ${chalk.cyan(String(summary.steps.length))}`);
        console.log();

        for (const step of summary.steps) {
          const errLabel = step.errors.length > 0
            ? chalk.red(` (${step.errors.length} error(s))`)
            : chalk.green(' (clean)');
          console.log(`  ${chalk.cyan(step.step_id)}: ${step.http_calls} HTTP, ${step.fs_operations} FS, ${step.total_duration_ms}ms${errLabel}`);
        }
        return;
      }

      if (opts.timeline && summary) {
        console.log(chalk.blue('Continuum Forensics Timeline'));
        console.log(chalk.gray(`Run: ${runId}`));
        console.log();

        for (const entry of summary.timeline) {
          const typeColor = entry.type === 'http' ? chalk.magenta : chalk.yellow;
          console.log(chalk.gray(`  ${entry.timestamp}  `) + typeColor(`[${entry.type}]`) + chalk.gray(` ${entry.step_id}  `) + entry.summary);
        }
        return;
      }

      // Default: show HTTP records
      const records = loadHttpRecords(runId, opts.step);

      if (records.length === 0) {
        console.log(chalk.yellow(opts.step
          ? `No HTTP forensics data for step: ${opts.step}`
          : 'No HTTP forensics data recorded.'
        ));
        return;
      }

      console.log(chalk.blue('Continuum Forensics'));
      console.log(chalk.gray(`Run: ${runId}`));
      console.log();

      // Group by step
      const byStep = new Map<string, typeof records>();
      for (const record of records) {
        const list = byStep.get(record.step_id) ?? [];
        list.push(record);
        byStep.set(record.step_id, list);
      }

      for (const [stepId, stepRecords] of byStep) {
        console.log(chalk.cyan(`Step: ${stepId}`));
        for (const record of stepRecords) {
          const statusColor = record.response.status >= 400 ? chalk.red : chalk.green;
          const errSuffix = record.error ? chalk.red(` [ERR: ${record.error}]`) : '';

          if (opts.errors && !record.error && record.response.status < 400) continue;

          console.log(
            chalk.gray(`  ${record.method} `) +
            record.url +
            chalk.gray(' → ') +
            statusColor(String(record.response.status)) +
            chalk.gray(` (${record.duration_ms}ms)`) +
            errSuffix,
          );

          if (record.response.body_preview) {
            console.log(chalk.gray(`    body: ${record.response.body_preview.slice(0, 200)}`));
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
