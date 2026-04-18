import { Command } from 'commander';
import chalk from 'chalk';
import {
  saveEnvironment,
  loadEnvironment,
  listEnvironments,
  deleteEnvironment,
  setVariable,
  removeVariable,
  promoteEnvironment,
  formatEnvironment,
} from '../core/env-manager.js';

export const envCommand = new Command('env')
  .description('Environment management');

envCommand
  .command('create')
  .description('Create a new environment')
  .argument('<name>', 'environment name')
  .option('-d, --description <desc>', 'description')
  .option('--inherits <parent>', 'parent environment to inherit from')
  .action((name: string, opts) => {
    saveEnvironment({
      name,
      description: opts.description,
      variables: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      inherits: opts.inherits,
    });
    console.log(`Environment created: ${name}`);
  });

envCommand
  .command('list')
  .description('List all environments')
  .action(() => {
    const envs = listEnvironments();
    if (envs.length === 0) {
      console.log('No environments.');
      return;
    }
    for (const e of envs) {
      const inherit = e.inherits ? ` (inherits: ${e.inherits})` : '';
      console.log(`  ${e.name.padEnd(20)} ${e.variables.length} vars${inherit}`);
    }
  });

envCommand
  .command('show')
  .description('Show an environment')
  .argument('<name>')
  .action((name: string) => {
    const env = loadEnvironment(name);
    if (!env) {
      console.error(chalk.red(`Not found: ${name}`));
      process.exit(1);
    }
    console.log(formatEnvironment(env));
  });

envCommand
  .command('set')
  .description('Set a variable')
  .argument('<env_name>')
  .argument('<key>')
  .argument('<value>')
  .option('-s, --secret', 'mark as secret', false)
  .option('-d, --description <desc>', 'variable description')
  .action((envName: string, key: string, value: string, opts) => {
    try {
      setVariable(envName, key, value, { secret: opts.secret, description: opts.description });
      console.log(`Set ${key} in ${envName}`);
    } catch (err: unknown) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

envCommand
  .command('unset')
  .description('Remove a variable')
  .argument('<env_name>')
  .argument('<key>')
  .action((envName: string, key: string) => {
    try {
      if (removeVariable(envName, key)) {
        console.log(`Removed ${key} from ${envName}`);
      } else {
        console.log(`Variable ${key} not found in ${envName}`);
      }
    } catch (err: unknown) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

envCommand
  .command('promote')
  .description('Promote variables from one environment to another')
  .argument('<from>', 'source environment')
  .argument('<to>', 'target environment')
  .option('--overwrite', 'overwrite existing variables', false)
  .option('--keys <keys>', 'comma-separated keys to promote')
  .action((from: string, to: string, opts) => {
    try {
      const result = promoteEnvironment(from, to, {
        overwrite: opts.overwrite,
        keys: opts.keys?.split(','),
      });
      console.log(`Promoted ${from} → ${to}: ${result.added.length} added, ${result.updated.length} updated, ${result.kept.length} kept`);
    } catch (err: unknown) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

envCommand
  .command('delete')
  .description('Delete an environment')
  .argument('<name>')
  .action((name: string) => {
    if (deleteEnvironment(name)) {
      console.log(`Deleted: ${name}`);
    } else {
      console.error(chalk.red(`Not found: ${name}`));
      process.exit(1);
    }
  });
