import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { exportRuns } from '../core/export.js';
import type { ExportFormat } from '../core/export.js';

export const exportCommand = new Command('export')
  .description('Export runs as HTML report, CSV, or Markdown')
  .option('-f, --format <format>', 'output format: html, csv, markdown', 'markdown')
  .option('-o, --output <file>', 'write to file instead of stdout')
  .option('--runs <ids>', 'comma-separated run IDs to export')
  .option('--status <status>', 'filter by status')
  .option('--since <date>', 'only runs after this ISO date')
  .option('--until <date>', 'only runs before this ISO date')
  .option('--no-steps', 'omit step details')
  .action((opts) => {
    const format = opts.format as ExportFormat;
    if (!['html', 'csv', 'markdown'].includes(format)) {
      console.error(`Error: unsupported format "${format}". Use html, csv, or markdown.`);
      process.exit(1);
    }

    const output = exportRuns(format, {
      runIds: opts.runs ? opts.runs.split(',') : undefined,
      status: opts.status,
      since: opts.since,
      until: opts.until,
      includeSteps: opts.steps !== false,
    });

    if (opts.output) {
      writeFileSync(opts.output, output, 'utf8');
      console.log(`Exported to ${opts.output}`);
    } else {
      console.log(output);
    }
  });
