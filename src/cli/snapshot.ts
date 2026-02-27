import { Command } from 'commander';
import chalk from 'chalk';
import {
  takeSnapshot,
  rollbackToSnapshot,
  diffSnapshot,
  listSnapshots,
  deleteSnapshot,
} from '../core/workspace-snapshot.js';

export const snapshotCommand = new Command('snapshot')
  .description('Manage workspace snapshots');

snapshotCommand
  .command('take')
  .description('Take a snapshot of the workspace')
  .argument('<workspace>', 'workspace directory to snapshot')
  .option('--id <id>', 'custom snapshot ID')
  .option('--ignore <patterns>', 'comma-separated ignore patterns')
  .action((workspace: string, opts) => {
    try {
      const snapshot = takeSnapshot(workspace, {
        snapshotId: opts.id,
        ignore: opts.ignore ? opts.ignore.split(',') : undefined,
      });
      console.log(`Snapshot: ${snapshot.snapshot_id}`);
      console.log(`  Files: ${snapshot.total_files}`);
      console.log(`  Size: ${(snapshot.total_size_bytes / 1024).toFixed(1)}KB`);
    } catch (err: unknown) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

snapshotCommand
  .command('rollback')
  .description('Rollback workspace to a snapshot')
  .argument('<snapshot_id>', 'snapshot ID to rollback to')
  .option('--remove-new', 'remove files added after snapshot', false)
  .action(async (snapshotId: string, opts) => {
    try {
      const { restored, removed } = rollbackToSnapshot(snapshotId, {
        removeNew: opts.removeNew,
      });
      console.log(`Rollback complete: ${restored} restored, ${removed} removed`);
    } catch (err: unknown) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

snapshotCommand
  .command('diff')
  .description('Compare workspace against a snapshot')
  .argument('<snapshot_id>', 'snapshot ID')
  .action((snapshotId: string) => {
    try {
      const result = diffSnapshot(snapshotId);
      console.log(`Added: ${result.added.length}  Modified: ${result.modified.length}  Deleted: ${result.deleted.length}`);
      for (const f of result.added) console.log(chalk.green(`  + ${f}`));
      for (const f of result.modified) console.log(chalk.yellow(`  ~ ${f}`));
      for (const f of result.deleted) console.log(chalk.red(`  - ${f}`));
    } catch (err: unknown) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

snapshotCommand
  .command('list')
  .description('List all snapshots')
  .action(() => {
    const snapshots = listSnapshots();
    if (snapshots.length === 0) {
      console.log('No snapshots.');
      return;
    }
    for (const s of snapshots) {
      console.log(`${s.snapshot_id}  ${s.total_files} files  ${(s.total_size_bytes / 1024).toFixed(1)}KB  ${s.created_at.slice(0, 19)}`);
    }
  });

snapshotCommand
  .command('delete')
  .description('Delete a snapshot')
  .argument('<snapshot_id>', 'snapshot ID')
  .action((snapshotId: string) => {
    if (deleteSnapshot(snapshotId)) {
      console.log(`Deleted snapshot: ${snapshotId}`);
    } else {
      console.error(`Snapshot not found: ${snapshotId}`);
      process.exit(1);
    }
  });
