import { Command } from 'commander';
import { searchRuns } from '../core/search.js';

export const searchCommand = new Command('search')
  .description('Search across runs by prompt, error, output, or step content')
  .argument('<query>', 'search text')
  .option('-n, --limit <n>', 'max results', '20')
  .option('--field <fields...>', 'fields to search: prompt, error, stdout, stderr, step_id, description')
  .option('--case-sensitive', 'case sensitive search', false)
  .option('--json', 'output as JSON', false)
  .action((query: string, opts) => {
    const results = searchRuns({
      query,
      limit: parseInt(opts.limit, 10),
      fields: opts.field,
      caseSensitive: opts.caseSensitive,
    });

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log(`No results for "${query}"`);
      return;
    }

    console.log(`Found ${results.length} result(s) for "${query}":\n`);
    for (const r of results) {
      console.log(`  [${r.status}] ${r.run_id.slice(0, 8)} | ${r.matchField}`);
      console.log(`    ${r.matchContext}`);
      console.log('');
    }
  });
