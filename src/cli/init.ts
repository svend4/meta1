import { Command } from 'commander';
import { initProject } from '../core/init.js';

export const initCommand = new Command('init')
  .description('Initialize a Continuum project in the current directory')
  .option('--dir <path>', 'target directory (default: cwd)')
  .option('--sandbox <type>', 'sandbox type: local or docker', 'local')
  .option('--force', 'overwrite existing files', false)
  .option('--with-example', 'create an example plan', false)
  .option('--json', 'output result as JSON', false)
  .action((opts) => {
    const result = initProject({
      dir: opts.dir,
      sandbox: opts.sandbox as 'local' | 'docker',
      force: opts.force,
      withExample: opts.withExample,
    });

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log('Continuum project initialized!\n');

    if (result.created.length > 0) {
      console.log('Created:');
      for (const f of result.created) {
        console.log(`  + ${f}`);
      }
    }

    if (result.skipped.length > 0) {
      console.log('Skipped (already exist):');
      for (const f of result.skipped) {
        console.log(`  - ${f}`);
      }
    }

    console.log(`\nConfig: ${result.configPath}`);
  });
