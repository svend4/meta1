import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { composePlans } from '../core/compose.js';
import type { ExecutionPlan } from '../types/execution-plan.js';

export const composeCommand = new Command('compose')
  .description('Compose multiple execution plans into one')
  .argument('<plans...>', 'plan files to compose')
  .option('--output <path>', 'write composed plan to file')
  .option('--id <planId>', 'ID for the composed plan')
  .option('--sequential', 'chain plans sequentially (second depends on first)', false)
  .option('--on-conflict <strategy>', 'collision strategy: prefix or error', 'prefix')
  .option('--json', 'output as JSON', false)
  .action((planFiles: string[], opts) => {
    const plans: ExecutionPlan[] = planFiles.map((f) => {
      const raw = readFileSync(f, 'utf8');
      return JSON.parse(raw) as ExecutionPlan;
    });

    const result = composePlans(plans, {
      planId: opts.id,
      sequential: opts.sequential,
      conflictStrategy: opts.onConflict as 'prefix' | 'error',
    });

    if (opts.output) {
      writeFileSync(opts.output, JSON.stringify(result.plan, null, 2) + '\n', 'utf8');
      console.log(`Composed plan written to ${opts.output}`);
    } else if (opts.json) {
      console.log(JSON.stringify(result.plan, null, 2));
    } else {
      console.log(`Composed plan: ${result.plan.plan_id}`);
      console.log(`  Steps: ${result.plan.steps.length}`);
      console.log(`  Sources: ${planFiles.join(', ')}`);
      if (result.renamedSteps.length > 0) {
        console.log(`  Renamed steps:`);
        for (const r of result.renamedSteps) {
          console.log(`    ${r.original} → ${r.renamed} (from ${r.sourcePlan})`);
        }
      }
    }
  });
