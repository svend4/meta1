import { Command } from 'commander';
import chalk from 'chalk';
import { runDoctor } from '../core/doctor.js';

export const doctorCommand = new Command('doctor')
  .description('Run diagnostic checks on the Continuum environment')
  .option('--json', 'Output as JSON')
  .action((opts: { json?: boolean }) => {
    const report = runDoctor();

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.failed > 0 ? 1 : 0);
      return;
    }

    console.log(chalk.bold('Continuum Doctor'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log();

    for (const check of report.checks) {
      const icon = check.status === 'ok'
        ? chalk.green('✓')
        : check.status === 'warn'
          ? chalk.yellow('!')
          : chalk.red('✗');

      console.log(`  ${icon} ${chalk.bold(check.name)}: ${check.message}`);
      if (check.detail) {
        console.log(chalk.gray(`    ${check.detail}`));
      }
    }

    console.log();
    console.log(
      chalk.bold('Summary: ') +
      chalk.green(`${report.passed} passed`) +
      (report.warnings > 0 ? chalk.yellow(`, ${report.warnings} warnings`) : '') +
      (report.failed > 0 ? chalk.red(`, ${report.failed} failed`) : ''),
    );

    if (report.failed > 0) {
      process.exit(1);
    }
  });
