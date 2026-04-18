import { Command } from 'commander';
import { archiveRuns, restoreArchive, listArchives, deleteArchive } from '../core/archive.js';

export const archiveCommand = new Command('archive')
  .description('Archive and restore old runs');

archiveCommand
  .command('create')
  .description('Archive runs into a compressed tarball')
  .argument('<run_ids...>', 'run IDs to archive')
  .option('--delete', 'delete runs after archiving', false)
  .option('--id <id>', 'custom archive ID')
  .action(async (runIds: string[], opts) => {
    try {
      const { archiveId, manifest, path } = await archiveRuns(runIds, {
        deleteAfter: opts.delete,
        archiveId: opts.id,
      });
      console.log(`Archived ${manifest.run_count} run(s) → ${archiveId}`);
      console.log(`  Path: ${path}`);
      console.log(`  Size: ${manifest.total_size_bytes} bytes`);
      if (opts.delete) {
        console.log('  Original runs deleted.');
      }
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

archiveCommand
  .command('restore')
  .description('Restore runs from an archive')
  .argument('<archive_id>', 'archive ID to restore')
  .option('--overwrite', 'overwrite existing runs', false)
  .action(async (archiveId: string, opts) => {
    try {
      const { restoredIds, skippedIds } = await restoreArchive(archiveId, {
        overwrite: opts.overwrite,
      });
      console.log(`Restored: ${restoredIds.length} run(s)`);
      if (restoredIds.length > 0) {
        for (const id of restoredIds) console.log(`  + ${id}`);
      }
      if (skippedIds.length > 0) {
        console.log(`Skipped (already exist): ${skippedIds.length}`);
        for (const id of skippedIds) console.log(`  - ${id}`);
      }
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

archiveCommand
  .command('list')
  .description('List all archives')
  .action(() => {
    const archives = listArchives();
    if (archives.length === 0) {
      console.log('No archives found.');
      return;
    }
    for (const { archiveId, manifest, sizeBytes } of archives) {
      console.log(`${archiveId}  ${manifest.run_count} run(s)  ${formatBytes(sizeBytes)}  ${manifest.created_at.slice(0, 19)}`);
    }
  });

archiveCommand
  .command('delete')
  .description('Delete an archive')
  .argument('<archive_id>', 'archive ID to delete')
  .action((archiveId: string) => {
    if (deleteArchive(archiveId)) {
      console.log(`Deleted archive: ${archiveId}`);
    } else {
      console.error(`Archive not found: ${archiveId}`);
      process.exit(1);
    }
  });

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
