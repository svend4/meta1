import { Command } from 'commander';
import { tagRun, untagRun, getRunTags, getRunsByTag, listTags, deleteTag, renameTag } from '../core/run-tags.js';

export const tagCommand = new Command('tag')
  .description('Manage run tags');

tagCommand
  .command('add')
  .description('Add a tag to a run')
  .argument('<run_id>', 'run ID')
  .argument('<tag>', 'tag name')
  .option('-d, --description <text>', 'tag description')
  .action((runId: string, tag: string, opts) => {
    try {
      tagRun(runId, tag, opts.description);
      console.log(`Tagged run ${runId.slice(0, 8)} with "${tag}"`);
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

tagCommand
  .command('remove')
  .description('Remove a tag from a run')
  .argument('<run_id>', 'run ID')
  .argument('<tag>', 'tag name')
  .action((runId: string, tag: string) => {
    if (untagRun(runId, tag)) {
      console.log(`Removed tag "${tag}" from run ${runId.slice(0, 8)}`);
    } else {
      console.error(`Tag "${tag}" not found on run ${runId.slice(0, 8)}`);
      process.exit(1);
    }
  });

tagCommand
  .command('show')
  .description('Show tags for a run')
  .argument('<run_id>', 'run ID')
  .action((runId: string) => {
    const tags = getRunTags(runId);
    if (tags.length === 0) {
      console.log(`No tags for run ${runId.slice(0, 8)}`);
    } else {
      console.log(`Tags for run ${runId.slice(0, 8)}: ${tags.join(', ')}`);
    }
  });

tagCommand
  .command('find')
  .description('Find runs with a tag')
  .argument('<tag>', 'tag name')
  .action((tag: string) => {
    const runIds = getRunsByTag(tag);
    if (runIds.length === 0) {
      console.log(`No runs with tag "${tag}"`);
    } else {
      console.log(`Runs with tag "${tag}" (${runIds.length}):`);
      for (const id of runIds) console.log(`  ${id}`);
    }
  });

tagCommand
  .command('list')
  .description('List all tags')
  .action(() => {
    const tags = listTags();
    if (tags.length === 0) {
      console.log('No tags defined.');
      return;
    }
    for (const t of tags) {
      const desc = t.description ? ` — ${t.description}` : '';
      console.log(`  ${t.tag} (${t.count} runs)${desc}`);
    }
  });

tagCommand
  .command('delete')
  .description('Delete a tag entirely')
  .argument('<tag>', 'tag name')
  .action((tag: string) => {
    if (deleteTag(tag)) {
      console.log(`Deleted tag "${tag}"`);
    } else {
      console.error(`Tag "${tag}" not found`);
      process.exit(1);
    }
  });

tagCommand
  .command('rename')
  .description('Rename a tag')
  .argument('<old_name>', 'current tag name')
  .argument('<new_name>', 'new tag name')
  .action((oldName: string, newName: string) => {
    try {
      if (renameTag(oldName, newName)) {
        console.log(`Renamed tag "${oldName}" → "${newName}"`);
      } else {
        console.error(`Tag "${oldName}" not found`);
        process.exit(1);
      }
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
