import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { runPreflight, type CheckResult } from '../core/preflight.js';
import { loadConfig } from '../core/config.js';

export const validateCommand = new Command('validate')
  .description('Run pre-flight validation checks')
  .argument('[plan_file]', 'Path to plan JSON file (optional)')
  .option('--workspace <dir>', 'Workspace directory to check')
  .option('--sandbox <type>', 'Sandbox type: local or docker')
  .option('--config <path>', 'Config file path')
  .option('--json', 'Output as JSON')
  .action((planFile: string | undefined, opts: {
    workspace?: string;
    sandbox?: string;
    config?: string;
    json?: boolean;
  }) => {
    try {
      const config = loadConfig(opts.config);

      let plan: unknown;
      if (planFile) {
        const filePath = resolve(planFile);
        if (!existsSync(filePath)) {
          console.error(chalk.red(`File not found: ${filePath}`));
          process.exit(1);
        }
        plan = JSON.parse(readFileSync(filePath, 'utf8'));
      }

      const sandboxType = (opts.sandbox ?? config.sandbox) as 'local' | 'docker' | undefined;

      const report = runPreflight({
        plan,
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        sandboxType,
        workspace: opts.workspace ?? config.workspace_dir,
      });

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        if (!report.valid) process.exit(1);
        return;
      }

      console.log(chalk.blue('Pre-flight Validation'));
      console.log(chalk.gray('─'.repeat(50)));

      for (const check of report.checks) {
        const icon = statusIcon(check);
        const color = statusColor(check);
        console.log(`${icon} ${color(check.check.padEnd(18))} ${check.message}`);
      }

      console.log(chalk.gray('─'.repeat(50)));

      if (report.valid) {
        console.log(chalk.green(`All checks passed (${report.checks.length} checks)`));
      } else {
        const failed = report.checks.filter((c) => c.status === 'fail');
        console.log(chalk.red(`${failed.length} check(s) failed`));
        process.exit(1);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (opts.json) {
        console.log(JSON.stringify({ valid: false, error: msg }));
      } else {
        console.error(chalk.red(msg));
      }
      process.exit(1);
    }
  });

function statusIcon(check: CheckResult): string {
  switch (check.status) {
    case 'pass': return chalk.green('[PASS]');
    case 'fail': return chalk.red('[FAIL]');
    case 'warn': return chalk.yellow('[WARN]');
    case 'skip': return chalk.gray('[SKIP]');
  }
}

function statusColor(check: CheckResult): (s: string) => string {
  switch (check.status) {
    case 'pass': return chalk.green;
    case 'fail': return chalk.red;
    case 'warn': return chalk.yellow;
    case 'skip': return chalk.gray;
  }
}
