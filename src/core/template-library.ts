/**
 * Plan template library — save reusable plan templates with typed
 * parameters, instantiate plans from templates with parameter substitution.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getBaseDir } from './paths.js';
import type { ExecutionPlan } from '../types/execution-plan.js';

/** Parameter definition for a template */
export interface TemplateParam {
  name: string;
  description?: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  default?: string;
}

/** A saved plan template */
export interface PlanTemplate {
  templateId: string;
  name: string;
  description: string;
  params: TemplateParam[];
  /** The plan blueprint with {{param}} placeholders */
  plan: ExecutionPlan;
  createdAt: string;
  tags?: string[];
}

/** Result of template instantiation */
export interface InstantiationResult {
  plan: ExecutionPlan;
  resolvedParams: Record<string, string>;
  unresolvedPlaceholders: string[];
}

function getTemplatesDir(): string {
  return join(getBaseDir(), 'templates');
}

/**
 * Save a plan as a reusable template.
 */
export function saveTemplate(template: PlanTemplate): void {
  const dir = getTemplatesDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${template.templateId}.json`),
    JSON.stringify(template, null, 2),
    'utf8',
  );
}

/**
 * Load a template by ID.
 */
export function loadTemplate(templateId: string): PlanTemplate | null {
  const path = join(getTemplatesDir(), `${templateId}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as PlanTemplate;
}

/**
 * List all saved templates.
 */
export function listTemplates(): PlanTemplate[] {
  const dir = getTemplatesDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as PlanTemplate)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Delete a template.
 */
export function deleteTemplate(templateId: string): boolean {
  const path = join(getTemplatesDir(), `${templateId}.json`);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/**
 * Instantiate a plan from a template with parameter values.
 */
export function instantiateTemplate(
  templateId: string,
  params: Record<string, string>,
): InstantiationResult {
  const template = loadTemplate(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  // Resolve params with defaults
  const resolved: Record<string, string> = {};
  for (const p of template.params) {
    if (params[p.name] !== undefined) {
      resolved[p.name] = coerceParam(params[p.name], p.type);
    } else if (p.default !== undefined) {
      resolved[p.name] = p.default;
    } else if (p.required) {
      throw new Error(`Missing required parameter: ${p.name}`);
    }
  }

  // Deep-clone and substitute
  const planJson = JSON.stringify(template.plan);
  let substituted = planJson;
  for (const [key, value] of Object.entries(resolved)) {
    substituted = substituted.split(`{{${key}}}`).join(value);
  }

  // Find unresolved placeholders
  const unresolved: string[] = [];
  const matches = substituted.match(/\{\{(\w+)\}\}/g);
  if (matches) {
    for (const m of matches) {
      const name = m.slice(2, -2);
      if (!unresolved.includes(name)) unresolved.push(name);
    }
  }

  const plan = JSON.parse(substituted) as ExecutionPlan;

  // Give the instantiated plan a unique ID
  plan.plan_id = `${template.templateId}-${Date.now()}`;

  return { plan, resolvedParams: resolved, unresolvedPlaceholders: unresolved };
}

/**
 * Create a template from an existing plan by extracting parameterizable values.
 */
export function createTemplateFromPlan(
  plan: ExecutionPlan,
  templateId: string,
  name: string,
  description: string,
  parameterize: Record<string, { placeholder: string; description?: string; type?: 'string' | 'number' | 'boolean' }>,
): PlanTemplate {
  let planJson = JSON.stringify(plan);

  const params: TemplateParam[] = [];
  for (const [value, config] of Object.entries(parameterize)) {
    planJson = planJson.split(value).join(`{{${config.placeholder}}}`);
    params.push({
      name: config.placeholder,
      description: config.description,
      type: config.type ?? 'string',
      required: true,
    });
  }

  const templatePlan = JSON.parse(planJson) as ExecutionPlan;

  const template: PlanTemplate = {
    templateId,
    name,
    description,
    params,
    plan: templatePlan,
    createdAt: new Date().toISOString(),
  };

  return template;
}

/**
 * Validate template parameters.
 */
export function validateTemplateParams(
  template: PlanTemplate,
  params: Record<string, string>,
): string[] {
  const issues: string[] = [];

  for (const p of template.params) {
    if (p.required && params[p.name] === undefined && p.default === undefined) {
      issues.push(`Missing required parameter: ${p.name}`);
    }
    if (params[p.name] !== undefined && p.type === 'number' && isNaN(Number(params[p.name]))) {
      issues.push(`Parameter "${p.name}" must be a number`);
    }
    if (params[p.name] !== undefined && p.type === 'boolean' && !['true', 'false'].includes(params[p.name])) {
      issues.push(`Parameter "${p.name}" must be "true" or "false"`);
    }
  }

  // Warn about unknown params
  const known = new Set(template.params.map((p) => p.name));
  for (const key of Object.keys(params)) {
    if (!known.has(key)) {
      issues.push(`Unknown parameter: ${key}`);
    }
  }

  return issues;
}

/**
 * Format template for display.
 */
export function formatTemplate(template: PlanTemplate): string {
  const lines: string[] = [];
  lines.push(`Template: ${template.name} (${template.templateId})`);
  lines.push(`  ${template.description}`);
  lines.push(`  Steps: ${template.plan.steps.length}`);
  if (template.tags?.length) lines.push(`  Tags: ${template.tags.join(', ')}`);
  lines.push(`  Parameters:`);
  for (const p of template.params) {
    const req = p.required ? 'required' : `default: ${p.default}`;
    lines.push(`    ${p.name} (${p.type}) — ${req}${p.description ? ` — ${p.description}` : ''}`);
  }
  return lines.join('\n');
}

// ── Internal ──

function coerceParam(value: string, type: 'string' | 'number' | 'boolean'): string {
  if (type === 'number' && isNaN(Number(value))) {
    throw new Error(`Parameter value "${value}" is not a valid number`);
  }
  if (type === 'boolean' && !['true', 'false'].includes(value)) {
    throw new Error(`Parameter value "${value}" must be "true" or "false"`);
  }
  return value;
}
