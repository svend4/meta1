import type { Assertion } from './assertion.js';
import type { ProtectedSurface } from './protected-surface.js';
import type { PlanLineage } from './plan-lineage.js';
import type { PlanIOSignature } from './plan-io-signature.js';

/** Retry policy for command steps */
export interface StepRetryPolicy {
  /** Maximum number of attempts (including the first). Default: 1 (no retry). */
  max_attempts: number;
  /** Initial backoff in milliseconds. Doubles each attempt. Default: 1000. */
  backoff_ms: number;
}

/** A file creation step — determinism is always guaranteed */
export interface CreateFileStep {
  step_id: string;
  type: 'create_file';
  description: string;
  path: string;
  content: string;
  determinism: 'guaranteed';
  /** Step IDs this step depends on. Empty or absent = depends on none (can run immediately). */
  depends_on?: string[];
  /** Maximum execution time in milliseconds. Step is aborted if exceeded. */
  timeout_ms?: number;
}

/** A command execution step */
export interface RunCommandStep {
  step_id: string;
  type: 'run_command';
  description: string;
  command: string;
  args: string[];
  determinism: 'guaranteed' | 'best_effort';
  /** Step IDs this step depends on. Empty or absent = depends on none (can run immediately). */
  depends_on?: string[];
  /** Maximum execution time in milliseconds. Step is aborted if exceeded. */
  timeout_ms?: number;
  /** Retry policy for transient failures. Only applies to run_command steps. */
  retry?: StepRetryPolicy;
  /** Environment variables passed to the command. Merged with sandbox env. */
  env?: Record<string, string>;
}

export type Step = CreateFileStep | RunCommandStep;

/** Identity of the planning system. Present when LLM generated the plan. */
export interface PlannerSignature {
  planner_model: string;
  planner_version?: string;
  system_prompt_hash: `sha256:${string}`;
  generated_at: string; // ISO 8601
}

/** A deterministic execution plan consisting of steps (sequential or DAG-parallel) */
export interface ExecutionPlan {
  plan_id: string;
  description?: string;
  steps: Step[];
  /** When 'parallel', steps with depends_on form a DAG; independent steps run concurrently. Default: 'sequential'. */
  execution_mode?: 'sequential' | 'parallel';
  planner_signature?: PlannerSignature;
}

/** v3.0 execution plan with assertions, protected surface, lineage, and I/O signature */
export interface ExecutionPlanV3 extends ExecutionPlan {
  version: '3.0';
  assertions?: Assertion[];
  protected_surface?: ProtectedSurface;
  lineage?: PlanLineage;
  plan_signature?: PlanIOSignature;
  /** Template variables: keys are variable names, values are defaults. Resolved at execution time. */
  variables?: Record<string, string>;
}

/** Check if a plan is v3.0 */
export function isPlanV3(plan: ExecutionPlan): plan is ExecutionPlanV3 {
  return (plan as ExecutionPlanV3).version === '3.0';
}
