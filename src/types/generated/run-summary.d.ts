/* Auto-generated from run-summary.json. Do not edit. */

/**
 * A single execution step
 */
export type Step = CreateFileStep | RunCommandStep;

/**
 * Summary of a completed (or failed) run, stored alongside the event log
 */
export interface RunSummary {
  run_id: string;
  task_id: string;
  /**
   * Original task prompt
   */
  prompt: string;
  status: 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  plan: ExecutionPlan;
  plan_hash: string;
  /**
   * Where the plan came from
   */
  plan_source?: 'llm' | 'cache' | 'file';
  /**
   * Plan cache key, if applicable
   */
  cache_key?: string;
  /**
   * Hash of the entire run (all artifact hashes combined)
   */
  run_hash?: string;
  steps: {
    step_id: string;
    type: 'create_file' | 'run_command';
    description?: string;
    status: 'completed' | 'failed' | 'skipped';
    artifact_hash?: string;
    duration_ms?: number;
    determinism?: 'guaranteed' | 'best_effort';
    error?: string;
    exit_code?: number;
    [k: string]: unknown;
  }[];
  environment?: {
    node_version?: string;
    npm_version?: string;
    platform?: string;
    arch?: string;
    /**
     * Docker image digest (sha256) of sandbox at time of run
     */
    sandbox_image_digest?: string;
    [k: string]: unknown;
  };
  /**
   * Path to the workspace directory
   */
  workspace?: string;
  [k: string]: unknown;
}
/**
 * The execution plan that was used
 */
export interface ExecutionPlan {
  /**
   * Unique identifier for this plan
   */
  plan_id: string;
  /**
   * Human-readable description of what this plan accomplishes
   */
  description?: string;
  /**
   * Ordered list of steps to execute sequentially
   *
   * @minItems 1
   */
  steps: [Step, ...Step[]];
  /**
   * Identity of the planning system. Present when LLM generated the plan. Absent for manual plans.
   */
  planner_signature?: {
    /**
     * Model identifier used for planning (e.g. claude-sonnet-4-20250514)
     */
    planner_model: string;
    /**
     * Version string from the API response if available
     */
    planner_version?: string;
    /**
     * Hash of the system prompt used. If this changes, plans may differ.
     */
    system_prompt_hash: string;
    generated_at: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
export interface CreateFileStep {
  /**
   * Unique identifier for this step within the plan
   */
  step_id: string;
  type: 'create_file';
  /**
   * Human-readable description of this step
   */
  description: string;
  /**
   * Relative file path to create (e.g. 'src/index.js')
   */
  path: string;
  /**
   * Exact file content to write
   */
  content: string;
  /**
   * File creation is always deterministic
   */
  determinism: 'guaranteed';
  [k: string]: unknown;
}
export interface RunCommandStep {
  /**
   * Unique identifier for this step within the plan
   */
  step_id: string;
  type: 'run_command';
  /**
   * Human-readable description of this step
   */
  description: string;
  /**
   * The command to execute (e.g. 'npm')
   */
  command: string;
  /**
   * Command arguments (e.g. ['install', '--save-exact'])
   */
  args: string[];
  /**
   * Whether this command produces deterministic output
   */
  determinism: 'guaranteed' | 'best_effort';
  [k: string]: unknown;
}
