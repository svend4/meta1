import { Command } from 'commander';
import chalk from 'chalk';
import { getLineageChain } from '../core/lineage.js';

export const historyCommand = new Command('history')
  .description('Show the generational history of a plan (v3.0)')
  .argument('<plan_hash>', 'Hash of the plan to trace (sha256:...)')
  .action(async (planHash: string) => {
    try {
      // Ensure hash has prefix
      const hash = planHash.startsWith('sha256:') ? planHash : `sha256:${planHash}`;
      const chain = getLineageChain(hash as `sha256:${string}`);

      if (chain.length === 0) {
        console.log(chalk.yellow(`No lineage found for ${hash}`));
        console.log(chalk.gray('This plan may not have been tracked with v3.0 lineage.'));
        return;
      }

      console.log(chalk.blue('Continuum Plan History'));
      console.log(chalk.gray(`Plan: ${hash}`));
      console.log();

      for (const entry of chain) {
        const l = entry.lineage;
        const shortHash = entry.planHash.replace('sha256:', '').slice(0, 12);
        const prefix = l.generation === 0 ? '' : '  └─ ';
        const indent = '  '.repeat(l.generation);

        let label: string;
        switch (l.mutation_type) {
          case 'original':
            label = chalk.green('original');
            break;
          case 'benign_drift_accepted':
            label = chalk.cyan('benign_drift');
            if (l.benign_drift_context) {
              const paths = l.benign_drift_context.changed_artifacts.map((a) => a.path).join(', ');
              label += chalk.gray(`: ${paths}`);
            }
            break;
          case 'repair_deterministic':
            label = chalk.yellow('deterministic repair');
            if (l.deterministic_repair) {
              label += chalk.gray(`: ${l.deterministic_repair.strategy_id}`);
            }
            break;
          case 'repair_llm':
            label = chalk.magenta('LLM repair');
            if (l.repair_context) {
              label += chalk.gray(`: ${l.repair_context.mutations_applied.length} mutation(s)`);
            }
            break;
          case 'manual_edit':
            label = chalk.white('manual edit');
            break;
        }

        console.log(`${indent}${prefix}gen ${l.generation}: sha256:${shortHash}... (${label})`);
        if (l.mutation_reason) {
          console.log(`${indent}   ${chalk.gray(l.mutation_reason)}`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
      process.exit(1);
    }
  });
