import { Command } from 'commander';
import chalk from 'chalk';
import { exportBundle, saveBundleToFile, loadBundleFromFile, importBundle } from '../core/plan-bundle.js';

export const bundleCommand = new Command('bundle')
  .description('Export/import portable plan bundles');

bundleCommand
  .command('export')
  .description('Export a plan and its lineage to a portable bundle file')
  .argument('<plan_hash>', 'Plan hash to export')
  .option('-o, --output <file>', 'Output file path', 'plan-bundle.json')
  .option('--description <text>', 'Description for the bundle')
  .option('--json', 'Output metadata as JSON')
  .action((planHash: string, opts: {
    output: string;
    description?: string;
    json?: boolean;
  }) => {
    try {
      const hash: `sha256:${string}` = planHash.startsWith('sha256:')
        ? planHash as `sha256:${string}`
        : `sha256:${planHash}` as `sha256:${string}`;

      const bundle = exportBundle(hash, { description: opts.description });
      saveBundleToFile(bundle, opts.output);

      if (opts.json) {
        console.log(JSON.stringify({
          plan_hash: bundle.plan_hash,
          bundle_hash: bundle.bundle_hash,
          lineage_depth: bundle.lineage_chain.length,
          steps: bundle.plan.steps.length,
          output: opts.output,
        }, null, 2));
      } else {
        console.log(chalk.green(`Bundle exported to ${opts.output}`));
        console.log(chalk.gray(`Plan hash:     ${bundle.plan_hash}`));
        console.log(chalk.gray(`Bundle hash:   ${bundle.bundle_hash}`));
        console.log(chalk.gray(`Lineage depth: ${bundle.lineage_chain.length} generation(s)`));
        console.log(chalk.gray(`Steps:         ${bundle.plan.steps.length}`));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(msg));
      process.exit(1);
    }
  });

bundleCommand
  .command('import')
  .description('Import a plan bundle into the local generations store')
  .argument('<bundle_file>', 'Path to bundle file')
  .option('--json', 'Output result as JSON')
  .action((bundleFile: string, opts: { json?: boolean }) => {
    try {
      const bundle = loadBundleFromFile(bundleFile);
      const importedHash = importBundle(bundle);

      if (opts.json) {
        console.log(JSON.stringify({
          plan_hash: importedHash,
          bundle_hash: bundle.bundle_hash,
          lineage_depth: bundle.lineage_chain.length,
          steps: bundle.plan.steps.length,
          source: bundle.metadata,
          imported_at: new Date().toISOString(),
        }, null, 2));
      } else {
        console.log(chalk.green('Bundle imported successfully.'));
        console.log(chalk.gray(`Plan hash:     ${importedHash}`));
        console.log(chalk.gray(`Bundle hash:   ${bundle.bundle_hash}`));
        console.log(chalk.gray(`Lineage depth: ${bundle.lineage_chain.length} generation(s)`));
        console.log(chalk.gray(`Steps:         ${bundle.plan.steps.length}`));
        if (bundle.metadata.description) {
          console.log(chalk.gray(`Description:   ${bundle.metadata.description}`));
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(msg));
      process.exit(1);
    }
  });

bundleCommand
  .command('verify')
  .description('Verify a bundle file integrity without importing')
  .argument('<bundle_file>', 'Path to bundle file')
  .action((bundleFile: string) => {
    try {
      const bundle = loadBundleFromFile(bundleFile);
      console.log(chalk.green('Bundle integrity verified.'));
      console.log(chalk.gray(`Plan hash:     ${bundle.plan_hash}`));
      console.log(chalk.gray(`Bundle hash:   ${bundle.bundle_hash}`));
      console.log(chalk.gray(`Exported:      ${bundle.exported_at}`));
      console.log(chalk.gray(`Steps:         ${bundle.plan.steps.length}`));
      if (bundle.metadata.source_host) {
        console.log(chalk.gray(`Source host:   ${bundle.metadata.source_host}`));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Verification failed: ${msg}`));
      process.exit(1);
    }
  });
