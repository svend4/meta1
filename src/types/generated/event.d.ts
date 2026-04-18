/* Auto-generated from event.json. Do not edit. */

/**
 * A single event in the append-only JSONL event log
 */
export type Event =
  | RunStartEvent
  | RunCompleteEvent
  | RunFailedEvent
  | PlanGeneratedEvent
  | PlanCacheHitEvent
  | PlanCacheMissEvent
  | PlanLoadedEvent
  | StepStartEvent
  | StepCompleteEvent
  | StepFailedEvent
  | ArtifactHashedEvent
  | ReplayStartEvent
  | ReplayVerifiedEvent
  | ReplayDivergedEvent;
export type RunStartEvent = BaseEvent & {
  type: 'run_start';
  task_id: string;
  prompt: string;
  model?: string;
  [k: string]: unknown;
};
export type RunCompleteEvent = BaseEvent & {
  type: 'run_complete';
  duration_ms: number;
  plan_hash: string;
  run_hash: string;
  [k: string]: unknown;
};
export type RunFailedEvent = BaseEvent & {
  type: 'run_failed';
  error: string;
  failed_step_id?: string;
  [k: string]: unknown;
};
export type PlanGeneratedEvent = BaseEvent & {
  type: 'plan_generated';
  plan_hash: string;
  step_count: number;
  [k: string]: unknown;
};
export type PlanCacheHitEvent = BaseEvent & {
  type: 'plan_cache_hit';
  cache_key: string;
  plan_hash: string;
  [k: string]: unknown;
};
export type PlanCacheMissEvent = BaseEvent & {
  type: 'plan_cache_miss';
  cache_key: string;
  reason: 'not_found';
  [k: string]: unknown;
};
export type PlanLoadedEvent = BaseEvent & {
  type: 'plan_loaded';
  source: 'file' | 'cache';
  path?: string;
  [k: string]: unknown;
};
export type StepStartEvent = BaseEvent & {
  type: 'step_start';
  step_id: string;
  step_type: 'create_file' | 'run_command';
  step_index: number;
  [k: string]: unknown;
};
export type StepCompleteEvent = BaseEvent & {
  type: 'step_complete';
  step_id: string;
  artifact_hash: string;
  duration_ms: number;
  [k: string]: unknown;
};
export type StepFailedEvent = BaseEvent & {
  type: 'step_failed';
  step_id: string;
  error: string;
  exit_code?: number;
  [k: string]: unknown;
};
export type ArtifactHashedEvent = BaseEvent & {
  type: 'artifact_hashed';
  step_id: string;
  artifact_hash: string;
  [k: string]: unknown;
};
export type ReplayStartEvent = BaseEvent & {
  type: 'replay_start';
  original_run_id: string;
  [k: string]: unknown;
};
export type ReplayVerifiedEvent = BaseEvent & {
  type: 'replay_verified';
  original_run_id: string;
  checks_passed: number;
  checks_total: number;
  [k: string]: unknown;
};
export type ReplayDivergedEvent = BaseEvent & {
  type: 'replay_diverged';
  original_run_id: string;
  step_id: string;
  expected_hash: string;
  actual_hash: string;
  [k: string]: unknown;
};

export interface BaseEvent {
  /**
   * ISO 8601 timestamp
   */
  ts: string;
  /**
   * ID of the run this event belongs to
   */
  run_id: string;
  [k: string]: unknown;
}
