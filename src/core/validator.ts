import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExecutionPlan } from '../types/execution-plan.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv = require('ajv') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addFormats = require('ajv-formats') as (ajv: any) => void;

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(__dirname, '..', '..', 'schemas');

function loadSchema(filename: string): object {
  return JSON.parse(readFileSync(join(schemasDir, filename), 'utf8'));
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Register all schemas (v2.1 + v3.0)
// Load referenced schemas first so $ref resolution works
ajv.addSchema(loadSchema('assertion.json'), 'assertion.json');
ajv.addSchema(loadSchema('assertion-result.json'), 'assertion-result.json');
ajv.addSchema(loadSchema('protected-surface.json'), 'protected-surface.json');
ajv.addSchema(loadSchema('plan-lineage.json'), 'plan-lineage.json');
ajv.addSchema(loadSchema('plan-signature.json'), 'plan-signature.json');
ajv.addSchema(loadSchema('dependency-fingerprint.json'), 'dependency-fingerprint.json');
ajv.addSchema(loadSchema('drift-vector.json'), 'drift-vector.json');

const executionPlanSchema = loadSchema('execution-plan.json');
const taskSpecSchema = loadSchema('task-spec.json');
const eventSchema = loadSchema('event.json');
const runSummarySchema = loadSchema('run-summary.json');

const validatePlan = ajv.compile(executionPlanSchema);
const validateTaskSpec = ajv.compile(taskSpecSchema);
const validateEvent = ajv.compile(eventSchema);
const validateRunSummary = ajv.compile(runSummarySchema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function formatErrors(errors: typeof validatePlan.errors): string[] {
  if (!errors) return [];
  return errors.map((e: { instancePath?: string; message?: string }) => {
    const path = e.instancePath || '/';
    return `${path}: ${e.message ?? 'unknown error'}`;
  });
}

export function validateExecutionPlan(data: unknown): ValidationResult {
  const valid = validatePlan(data);
  return { valid: !!valid, errors: formatErrors(validatePlan.errors) };
}

export function assertValidPlan(data: unknown): asserts data is ExecutionPlan {
  const result = validateExecutionPlan(data);
  if (!result.valid) {
    throw new Error(
      `Invalid ExecutionPlan:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
}

export function validateTaskSpecData(data: unknown): ValidationResult {
  const valid = validateTaskSpec(data);
  return { valid: !!valid, errors: formatErrors(validateTaskSpec.errors) };
}

export function validateEventData(data: unknown): ValidationResult {
  const valid = validateEvent(data);
  return { valid: !!valid, errors: formatErrors(validateEvent.errors) };
}

export function validateRunSummaryData(data: unknown): ValidationResult {
  const valid = validateRunSummary(data);
  return { valid: !!valid, errors: formatErrors(validateRunSummary.errors) };
}
