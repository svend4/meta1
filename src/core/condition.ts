import { existsSync } from 'node:fs';
import type { StepCondition } from '../types/execution-plan.js';
import type { StepResult } from '../types/run-summary.js';

/**
 * Evaluate a step condition at runtime.
 * Returns true if the step should execute, false if it should be skipped.
 */
export function evaluateCondition(
  condition: StepCondition,
  context: ConditionContext,
): boolean {
  let result: boolean;

  switch (condition.type) {
    case 'env_var':
      result = evaluateEnvVar(condition, context);
      break;
    case 'file_exists':
      result = evaluateFileExists(condition, context);
      break;
    case 'step_status':
      result = evaluateStepStatus(condition, context);
      break;
    default:
      result = true;
  }

  return condition.negate ? !result : result;
}

/** Runtime context for condition evaluation */
export interface ConditionContext {
  /** Environment variables available. */
  env: Record<string, string | undefined>;
  /** Base directory for file existence checks. */
  workspacePath: string;
  /** Results of previously completed steps (by step_id). */
  stepResults: Map<string, StepResult>;
}

function evaluateEnvVar(condition: StepCondition, context: ConditionContext): boolean {
  const value = context.env[condition.target];
  if (condition.equals !== undefined) {
    return value === condition.equals;
  }
  // Just check if the env var is set and non-empty
  return value !== undefined && value !== '';
}

function evaluateFileExists(condition: StepCondition, context: ConditionContext): boolean {
  const { join } = require('node:path') as typeof import('node:path');
  const fullPath = join(context.workspacePath, condition.target);
  return existsSync(fullPath);
}

function evaluateStepStatus(condition: StepCondition, context: ConditionContext): boolean {
  const stepResult = context.stepResults.get(condition.target);
  if (!stepResult) return false;
  if (condition.equals) {
    return stepResult.status === condition.equals;
  }
  return stepResult.status === 'completed';
}
