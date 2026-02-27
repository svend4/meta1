import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { replay } from '../core/replayer.js';
import { analyzePlan } from '../core/dry-run.js';
import { loadRunSummary } from '../storage/runs.js';
import { LocalSandbox } from '../sandbox/local.js';
import { getDefaultWorkspace } from '../core/paths.js';

export const replayCommand = new Command('replay')
  .description('Re-execute a run and verify integrity + correctness (v3.0)')
  .argument('<run_id>', 'ID of the run to replay')
  .option('--workspace <dir>', 'Output directory for replay')
  .option('--heal', 'Attempt to repair drifts via Repair Cascade (v3.0)')
  .option('--forensics', 'Record HTTP calls for post-mortem analysis (v3.0)')
  .option('--api-key <key>', 'Anthropic API key (for --heal Level 3)')
  .option('--dry-run', 'Preview what replay would do without executing')
  .option('--json', 'Output result as JSON (for CI pipelines)')
  .action(async (runId: string, opts: {
    workspace?: string;
    heal?: boolean;
    forensics?: boolean;
    apiKey?: string;
    dryRun?: boolean;
    json?: boolean;
  }) => {
    // Dry-run mode for replay
    if (opts.dryRun) {
      try {
        const original = loadRunSummary(runId);
        const analysis = analyzePlan(original.plan);

        if (opts.json) {
          console.log(JSON.stringify({
            dry_run: true,
            original_run_id: runId,
            original_status: original.status,
            ...analysis,
          }, null, 2));
          return;
        }

        console.log(chalk.blue('Replay Dry Run'));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.gray(`Original:   ${runId}`));
        console.log(chalk.gray(`Status:     ${original.status}`));
        console.log(chalk.gray(`Steps:      ${analysis.total_steps}`));
        console.log(chalk.gray(`Layers:     ${analysis.layers}`));
        console.log(chalk.gray(`Mode:       ${analysis.execution_mode}`));
        if (analysis.assertions_count > 0) {
          console.log(chalk.gray(`Assertions: ${analysis.assertions_count}`));
        }
        console.log();

        for (const step of analysis.steps) {
          const icon = step.type === 'create_file' ? chalk.green('F') : chalk.yellow('C');
          console.log(`  L${step.layer} ${icon} ${step.step_id}`);
          console.log(chalk.gray(`     ${step.description}`));
        }

        for (const warn of analysis.warnings) {
          console.log(chalk.yellow(`\nWarning: ${warn}`));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(msg));
        process.exit(1);
      }
      return;
    }

    const workspace = opts.workspace
      ? resolve(opts.workspace)
      : getDefaultWorkspace(randomUUID());

    const sandbox = new LocalSandbox(workspace);

    try {
      if (!opts.json) {
        console.log(chalk.blue('Continuum Replay'));
        console.log(chalk.gray(`Original:  ${runId}`));
        console.log(chalk.gray(`Workspace: ${workspace}`));
        if (opts.heal) console.log(chalk.yellow(`Mode:      --heal (Repair Cascade enabled)`));
        if (opts.forensics) console.log(chalk.yellow(`Forensics: enabled`));
        console.log();
      }

      const result = await replay(runId, sandbox, workspace, {
        heal: opts.heal,
        forensics: opts.forensics,
        apiKey: opts.apiKey,
      });

      if (opts.json) {
        const output = {
          status: result.summary.status,
          verdict: result.verdict,
          replay_run_id: result.summary.run_id,
          original_run_id: runId,
          verified: result.verified,
          checks_passed: result.checksPassed,
          checks_total: result.checksTotal,
          divergences: result.divergences.length,
          drift_vectors: result.driftVectors?.length ?? 0,
          assertions_passed: result.assertionResults?.filter((r) => r.passed).length,
          assertions_total: result.assertionResults?.length,
          new_generation: result.newGeneration ? {
            plan_hash: result.newGeneration.planHash,
            generation: result.newGeneration.lineage.generation,
            mutation_type: result.newGeneration.lineage.mutation_type,
          } : undefined,
          duration_ms: result.summary.duration_ms,
        };
        console.log(JSON.stringify(output, null, 2));
        if (result.verdict === 'drifted' || result.verdict === 'repair_failed' || !result.verified) {
          process.exit(1);
        }
        return;
      }

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
            console.log(chalk.green('IDENTICAL — hashes match, assertions pass.'));
            break;
          case 'benign_drift':
            console.log(chalk.cyan('BENIGN DRIFT — hashes differ, assertions pass, no protected paths affected.'));
            if (result.newGeneration) {
              console.log(chalk.cyan(`   New generation: gen ${result.newGeneration.lineage.generation} (${result.newGeneration.planHash.slice(0, 19)}...)`));
            }
            break;
          case 'drifted':
            console.log(chalk.red('DRIFTED — assertions failed or protected paths affected.'));
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
            console.log(chalk.green('HEALED — drift repaired successfully.'));
            if (result.newGeneration) {
              console.log(chalk.green(`   New generation: gen ${result.newGeneration.lineage.generation} (${result.newGeneration.lineage.mutation_type})`));
            }
            break;
          case 'repair_failed':
            console.log(chalk.red('REPAIR FAILED — cascade could not resolve all drifts.'));
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
      if (opts.json) {
        console.log(JSON.stringify({ status: 'error', error: msg }));
      } else {
        console.error(chalk.red(`Fatal: ${msg}`));
      }
      process.exit(1);
    }
  });
