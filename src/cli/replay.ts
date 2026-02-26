import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { replay } from '../core/replayer.js';
import { LocalSandbox } from '../sandbox/local.js';
import { getDefaultWorkspace } from '../core/paths.js';

export const replayCommand = new Command('replay')
  .description('Re-execute a run and verify integrity + correctness (v3.0)')
  .argument('<run_id>', 'ID of the run to replay')
  .option('--workspace <dir>', 'Output directory for replay')
  .option('--heal', 'Attempt to repair drifts via Repair Cascade (v3.0)')
  .option('--forensics', 'Record HTTP calls for post-mortem analysis (v3.0)')
  .option('--api-key <key>', 'Anthropic API key (for --heal Level 3)')
  .action(async (runId: string, opts: {
    workspace?: string;
    heal?: boolean;
    forensics?: boolean;
    apiKey?: string;
  }) => {
    const workspace = opts.workspace
      ? resolve(opts.workspace)
      : getDefaultWorkspace(randomUUID());

    const sandbox = new LocalSandbox(workspace);

    try {
      console.log(chalk.blue('Continuum Replay'));
      console.log(chalk.gray(`Original:  ${runId}`));
      console.log(chalk.gray(`Workspace: ${workspace}`));
      if (opts.heal) console.log(chalk.yellow(`Mode:      --heal (Repair Cascade enabled)`));
      if (opts.forensics) console.log(chalk.yellow(`Forensics: enabled`));
      console.log();

      const result = await replay(runId, sandbox, workspace, {
        heal: opts.heal,
        forensics: opts.forensics,
        apiKey: opts.apiKey,
      });

      console.log(chalk.gray(`Replay ID: ${result.summary.run_id}`));
      console.log(chalk.gray(`Checks:    ${result.checksPassed}/${result.checksTotal} passed`));

      // v3.0: Show assertion results
      if (result.assertionResults) {
        const passed = result.assertionResults.filter((r) => r.passed).length;
        const total = result.assertionResults.length;
        console.log(chalk.gray(`Assertions: ${passed}/${total} passed`));
      }

      // v3.0: Show verdict
      if (result.verdict) {
        switch (result.verdict) {
          case 'identical':
            console.log(chalk.green('✅ IDENTICAL — hashes match, assertions pass.'));
            break;
          case 'benign_drift':
            console.log(chalk.cyan('✅ BENIGN DRIFT — hashes differ, assertions pass, no protected paths affected.'));
            if (result.newGeneration) {
              console.log(chalk.cyan(`   New generation: gen ${result.newGeneration.lineage.generation} (${result.newGeneration.planHash.slice(0, 19)}...)`));
            }
            break;
          case 'drifted':
            console.log(chalk.red('❌ DRIFTED — assertions failed or protected paths affected.'));
            if (result.driftVectors) {
              for (const d of result.driftVectors) {
                console.log(chalk.red(`  ${d.category}: ${d.details.expected} → ${d.details.actual} [${d.severity}]`));
              }
            }
            if (!opts.heal) {
              console.log(chalk.yellow('   Hint: run with --heal to attempt repair'));
            }
            break;
          case 'healed':
            console.log(chalk.green('✅ HEALED — drift repaired successfully.'));
            if (result.newGeneration) {
              console.log(chalk.green(`   New generation: gen ${result.newGeneration.lineage.generation} (${result.newGeneration.lineage.mutation_type})`));
            }
            break;
          case 'repair_failed':
            console.log(chalk.red('❌ REPAIR FAILED — cascade could not resolve all drifts.'));
            if (result.driftVectors) {
              for (const d of result.driftVectors) {
                console.log(chalk.red(`  ${d.category}: ${d.details.expected} → ${d.details.actual}`));
              }
            }
            break;
        }
      } else {
        // v2.1 fallback
        if (result.verified) {
          console.log(chalk.green('Replay verified — all guaranteed steps match.'));
        } else {
          console.error(chalk.red('Replay DIVERGED — guaranteed step hashes differ:'));
          for (const d of result.divergences) {
            console.error(chalk.red(`  ${d.stepId}:`));
            console.error(chalk.gray(`    expected: ${d.expectedHash}`));
            console.error(chalk.gray(`    actual:   ${d.actualHash}`));
          }
        }
      }

      if (result.verdict === 'drifted' || result.verdict === 'repair_failed' || !result.verified) {
        process.exit(1);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Fatal: ${msg}`));
      process.exit(1);
    }
  });
