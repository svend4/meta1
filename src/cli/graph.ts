import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { loadGenerationPlan } from '../core/lineage.js';
import { computeLayers } from '../core/dry-run.js';
import { planToDot } from '../core/dot-graph.js';
import type { ExecutionPlan } from '../types/execution-plan.js';

export const graphCommand = new Command('graph')
  .description('Visualize a plan\'s dependency graph')
  .argument('<source>', 'Plan hash (sha256:...) or path to plan JSON file')
  .option('--json', 'Output graph as JSON adjacency list')
  .option('--dot', 'Output as Graphviz DOT format')
  .option('--lr', 'Use left-to-right layout (with --dot)')
  .action((source: string, opts: { json?: boolean; dot?: boolean; lr?: boolean }) => {
    try {
      let plan: ExecutionPlan;

      if (source.startsWith('sha256:') || (/^[a-f0-9]{64}$/i).test(source)) {
        const hash: `sha256:${string}` = source.startsWith('sha256:')
          ? source as `sha256:${string}`
          : `sha256:${source}` as `sha256:${string}`;
        const loaded = loadGenerationPlan(hash);
        if (!loaded) {
          console.error(chalk.red(`Plan not found: ${hash}`));
          process.exit(1);
        }
        plan = loaded;
      } else {
        const filePath = resolve(source);
        if (!existsSync(filePath)) {
          console.error(chalk.red(`File not found: ${filePath}`));
          process.exit(1);
        }
        plan = JSON.parse(readFileSync(filePath, 'utf8'));
      }

      if (opts.dot) {
        console.log(planToDot(plan, { rankdir: opts.lr ? 'LR' : 'TB' }));
        return;
      }

      if (opts.json) {
        const adj: Record<string, { type: string; depends_on: string[]; dependents: string[] }> = {};
        const depMap = new Map<string, string[]>();
        for (const step of plan.steps) {
          depMap.set(step.step_id, step.depends_on ?? []);
        }
        for (const step of plan.steps) {
          const dependents = plan.steps
            .filter((s) => (s.depends_on ?? []).includes(step.step_id))
            .map((s) => s.step_id);
          adj[step.step_id] = {
            type: step.type,
            depends_on: step.depends_on ?? [],
            dependents,
          };
        }
        console.log(JSON.stringify({
          plan_id: plan.plan_id,
          execution_mode: plan.execution_mode ?? 'sequential',
          steps: plan.steps.length,
          graph: adj,
        }, null, 2));
        return;
      }

      console.log(chalk.blue('Dependency Graph'));
      console.log(chalk.gray('═'.repeat(60)));
      if (plan.description) console.log(chalk.gray(plan.description));
      console.log(chalk.gray(`Mode: ${plan.execution_mode ?? 'sequential'}`));
      console.log();

      // Compute layers (topological levels)
      const layers = computeLayers(plan.steps);

      for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
        const layer = layers[layerIdx];
        const isMulti = layer.length > 1;
        const prefix = isMulti ? chalk.cyan('║') : chalk.gray('│');

        if (isMulti) {
          console.log(chalk.cyan(`╔═ Layer ${layerIdx} (parallel: ${layer.length} steps)`));
        }

        for (const step of layer) {
          const typeIcon = step.type === 'create_file' ? chalk.green('F') : chalk.yellow('C');
          const deps = step.depends_on ?? [];
          const depsStr = deps.length > 0 ? chalk.gray(` ← [${deps.join(', ')}]`) : '';

          if (isMulti) {
            console.log(`${prefix}  ${typeIcon} ${chalk.white(step.step_id)}${depsStr}`);
            console.log(`${prefix}    ${chalk.gray(step.description)}`);
          } else {
            console.log(`${chalk.gray('│')}  ${typeIcon} ${chalk.white(step.step_id)}${depsStr}`);
            console.log(`${chalk.gray('│')}    ${chalk.gray(step.description)}`);
          }
        }

        if (isMulti) {
          console.log(chalk.cyan('╚═'));
        }

        if (layerIdx < layers.length - 1) {
          console.log(chalk.gray('│'));
          console.log(chalk.gray('▼'));
        }
      }

      console.log();
      console.log(chalk.gray(`${plan.steps.length} steps, ${layers.length} layers`));
      const roots = plan.steps.filter((s) => !(s.depends_on?.length));
      const leaves = plan.steps.filter((s) => {
        return !plan.steps.some((other) => (other.depends_on ?? []).includes(s.step_id));
      });
      console.log(chalk.gray(`Roots: ${roots.map((s) => s.step_id).join(', ')}`));
      console.log(chalk.gray(`Leaves: ${leaves.map((s) => s.step_id).join(', ')}`));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(msg));
      process.exit(1);
    }
  });

