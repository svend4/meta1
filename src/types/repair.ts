import type { ExecutionPlan } from './execution-plan.js';
import type { DriftVector } from './drift-vector.js';
import type { AssertionResult } from './assertion.js';
import type { DependencyFingerprint } from './dependency-fingerprint.js';
import type { PlannerSignature } from './execution-plan.js';
import type { RepairMutation, AppliedMutation } from './plan-lineage.js';

/** Context snippet for LLM repair — diffs and errors per step */
export interface RepairContextSnippet {
  step_id: string;
  file_path?: string;
  before_content?: string;
  after_content?: string;
  diff?: string;
  error_output?: string;
}

/** Budget constraints for repair operations */
export interface RepairBudget {
  max_tokens: number;
  max_cost_usd: number;
  timeout_ms: number;
}

/** Constraints on what the repair compiler may do */
export interface RepairConstraints {
  max_steps_modified: number;
  max_repair_attempts: number;
  preserve_step_ids: boolean;
  allowed_mutations: RepairMutation[];
  budget: RepairBudget;
}

/** Request sent to the LLM Repair Compiler (Level 3) */
export interface RepairRequest {
  original_plan: ExecutionPlan;
  drift_vectors: DriftVector[];
  failed_assertions: AssertionResult[];
  environment_diff: {
    original: DependencyFingerprint;
    current: DependencyFingerprint;
  };
  constraints: RepairConstraints;
  context_snippets?: RepairContextSnippet[];
}

/** Response from the LLM Repair Compiler */
export interface RepairResponse {
  repaired_plan: ExecutionPlan;
  mutations_applied: AppliedMutation[];
  repair_signature: PlannerSignature;
}

/** Actions a deterministic repair strategy can take */
export type RepairAction =
  | { type: 'run_command'; command: string; args: string[] }
  | { type: 'update_step'; step_id: string; field: string; value: unknown }
  | { type: 'restore_artifact'; path: string; from_run: string };

/** A deterministic repair strategy (Level 2) */
export interface DeterministicRepairStrategy {
  id: string;
  matches: (drift: DriftVector) => boolean;
  repair: (drift: DriftVector, context: RepairContext) => RepairAction[];
  description: string;
}

/** Context available to repair strategies */
export interface RepairContext {
  workspace: string;
  source_run_id: string;
}

/** Default repair budget */
export const DEFAULT_REPAIR_BUDGET: RepairBudget = {
  max_tokens: 8192,
  max_cost_usd: 0.50,
  timeout_ms: 30000,
};

/** Default repair constraints */
export const DEFAULT_REPAIR_CONSTRAINTS: RepairConstraints = {
  max_steps_modified: 3,
  max_repair_attempts: 1,
  preserve_step_ids: true,
  allowed_mutations: ['update_version', 'modify_content', 'modify_command', 'update_assertion'],
  budget: DEFAULT_REPAIR_BUDGET,
};
