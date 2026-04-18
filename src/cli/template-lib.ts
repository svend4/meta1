import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import {
  saveTemplate,
  loadTemplate,
  listTemplates,
  deleteTemplate,
  instantiateTemplate,
  formatTemplate,
  createTemplateFromPlan,
} from '../core/template-library.js';
import type { ExecutionPlan } from '../types/execution-plan.js';

export const templateCommand = new Command('template')
  .description('Plan template library');

templateCommand
  .command('save')
  .description('Save a plan as a reusable template')
  .argument('<plan_file>', 'path to plan JSON')
  .option('--id <id>', 'template ID')
  .option('--name <name>', 'template name')
  .option('--desc <description>', 'template description', '')
  .action((planFile: string, opts) => {
    try {
      const filePath = resolve(planFile);
      if (!existsSync(filePath)) {
        console.error(chalk.red(`File not found: ${filePath}`));
        process.exit(1);
      }
      const plan = JSON.parse(readFileSync(filePath, 'utf8')) as ExecutionPlan;
      const id = opts.id ?? plan.plan_id;
      const template = createTemplateFromPlan(plan, id, opts.name ?? id, opts.desc, {});
      saveTemplate(template);
      console.log(`Template saved: ${id}`);
    } catch (err: unknown) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

templateCommand
  .command('list')
  .description('List all templates')
  .action(() => {
    const templates = listTemplates();
    if (templates.length === 0) {
      console.log('No templates.');
      return;
    }
    for (const t of templates) {
      console.log(`  ${t.templateId.padEnd(25)} ${t.name.padEnd(20)} ${t.params.length} params  ${t.plan.steps.length} steps`);
    }
  });

templateCommand
  .command('show')
  .description('Show template details')
  .argument('<template_id>')
  .action((templateId: string) => {
    const t = loadTemplate(templateId);
    if (!t) {
      console.error(chalk.red(`Template not found: ${templateId}`));
      process.exit(1);
    }
    console.log(formatTemplate(t));
  });

templateCommand
  .command('instantiate')
  .description('Create a plan from a template')
  .argument('<template_id>')
  .option('-p, --params <json>', 'JSON object of parameter values', '{}')
  .option('-o, --output <file>', 'write plan to file')
  .action((templateId: string, opts) => {
    try {
      const params = JSON.parse(opts.params);
      const result = instantiateTemplate(templateId, params);

      if (result.unresolvedPlaceholders.length > 0) {
        console.error(chalk.yellow(`Warning: unresolved placeholders: ${result.unresolvedPlaceholders.join(', ')}`));
      }

      if (opts.output) {
        const { writeFileSync } = require('node:fs');
        writeFileSync(opts.output, JSON.stringify(result.plan, null, 2), 'utf8');
        console.log(`Plan written to ${opts.output}`);
      } else {
        console.log(JSON.stringify(result.plan, null, 2));
      }
    } catch (err: unknown) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

templateCommand
  .command('delete')
  .description('Delete a template')
  .argument('<template_id>')
  .action((templateId: string) => {
    if (deleteTemplate(templateId)) {
      console.log(`Deleted: ${templateId}`);
    } else {
      console.error(chalk.red(`Not found: ${templateId}`));
      process.exit(1);
    }
  });
