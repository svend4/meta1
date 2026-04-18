import type { PlannerSignature } from './execution-plan.js';

/** Mutation types applied to plans */
export type MutationType =
  | 'original'
  | 'repair_deterministic'
  | 'repair_llm'
  | 'benign_drift_accepted'
  | 'manual_edit';

/** Repair mutation kinds */
export type RepairMutation =
  | 'update_version'
  | 'modify_content'
  | 'modify_command'
  | 'update_assertion';

/** A single applied mutation from repair */
export interface AppliedMutation {
  type: RepairMutation;
  step_id: string;
  description: string;
  before_hash: `sha256:${string}`;
  after_hash: `sha256:${string}`;
}

/** Tracks the generational history of a plan */
export interface PlanLineage {
  parent_plan_hash?: `sha256:${string}`;
  mutation_type: MutationType;
  mutation_reason?: string;
  generation: number;

  repair_context?: {
    drift_vectors: string[];
    repair_prompt_hash: `sha256:${string}`;
    repair_signature: PlannerSignature;
    mutations_applied: AppliedMutation[];
  };

  deterministic_repair?: {
    strategy_id: string;
    drift_vectors: string[];
  };

  benign_drift_context?: {
    changed_artifacts: Array<{
      path: string;
      old_hash: `sha256:${string}`;
      new_hash: `sha256:${string}`;
    }>;
    assertions_verified: boolean;
  };
}
