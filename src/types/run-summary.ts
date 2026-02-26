import type { ExecutionPlan } from './execution-plan.js';
import type { AssertionResult } from './assertion.js';
import type { DependencyFingerprint } from './dependency-fingerprint.js';

export interface StepResult {
  step_id: string;
  type: 'create_file' | 'run_command';
  description?: string;
  status: 'completed' | 'failed' | 'skipped';
  artifact_hash?: `sha256:${string}`;
  duration_ms?: number;
  determinism?: 'guaranteed' | 'best_effort';
  error?: string;
  exit_code?: number;
}

export interface Environment {
  node_version?: string;
  npm_version?: string;
  platform?: string;
  arch?: string;
  sandbox_image_digest?: string;
}

/** v3.0 status values extend v2.1's 'completed' | 'failed' */
export type RunStatus =
  | 'completed'
  | 'failed'
  | 'verified'
  | 'assertion_failed'
  | 'benign_drift'
  | 'healed';

export interface RunSummary {
  run_id: string;
  task_id: string;
  prompt: string;
  status: RunStatus;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  plan: ExecutionPlan;
  plan_hash: `sha256:${string}`;
  plan_source: 'llm' | 'cache' | 'file';
  cache_key?: `sha256:${string}`;
  run_hash?: `sha256:${string}`;
  steps: StepResult[];
  environment?: Environment;
  workspace?: string;

  // v3.0 fields
  assertions_passed?: number;
  assertions_total?: number;
  assertion_results?: AssertionResult[];
  dependency_fingerprint?: DependencyFingerprint;
}
