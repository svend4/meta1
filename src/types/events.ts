/** Base fields present on every event */
interface BaseEvent {
  ts: string; // ISO 8601
  run_id: string;
}

export interface RunStartEvent extends BaseEvent {
  type: 'run_start';
  task_id: string;
  prompt: string;
  model?: string;
}

export interface RunCompleteEvent extends BaseEvent {
  type: 'run_complete';
  duration_ms: number;
  plan_hash: `sha256:${string}`;
  run_hash: `sha256:${string}`;
}

export interface RunFailedEvent extends BaseEvent {
  type: 'run_failed';
  error: string;
  failed_step_id?: string;
}

export interface PlanGeneratedEvent extends BaseEvent {
  type: 'plan_generated';
  plan_hash: `sha256:${string}`;
  step_count: number;
}

export interface PlanCacheHitEvent extends BaseEvent {
  type: 'plan_cache_hit';
  cache_key: `sha256:${string}`;
  plan_hash: `sha256:${string}`;
}

export interface PlanCacheMissEvent extends BaseEvent {
  type: 'plan_cache_miss';
  cache_key: `sha256:${string}`;
  reason: 'not_found';
}

export interface PlanLoadedEvent extends BaseEvent {
  type: 'plan_loaded';
  source: 'file' | 'cache';
  path?: string;
}

export interface StepStartEvent extends BaseEvent {
  type: 'step_start';
  step_id: string;
  step_type: 'create_file' | 'run_command';
  step_index: number;
}

export interface StepCompleteEvent extends BaseEvent {
  type: 'step_complete';
  step_id: string;
  artifact_hash: `sha256:${string}`;
  duration_ms: number;
}

export interface StepFailedEvent extends BaseEvent {
  type: 'step_failed';
  step_id: string;
  error: string;
  exit_code?: number;
}

export interface ArtifactHashedEvent extends BaseEvent {
  type: 'artifact_hashed';
  step_id: string;
  artifact_hash: `sha256:${string}`;
}

export interface ReplayStartEvent extends BaseEvent {
  type: 'replay_start';
  original_run_id: string;
}

export interface ReplayVerifiedEvent extends BaseEvent {
  type: 'replay_verified';
  original_run_id: string;
  checks_passed: number;
  checks_total: number;
}

export interface ReplayDivergedEvent extends BaseEvent {
  type: 'replay_diverged';
  original_run_id: string;
  step_id: string;
  expected_hash: `sha256:${string}`;
  actual_hash: `sha256:${string}`;
}

// v3.0 Fingerprint events
export interface FingerprintCapturedEvent extends BaseEvent {
  type: 'fingerprint_captured';
  fingerprint_hash: `sha256:${string}`;
  tools: Record<string, string>;
  lockfile_hash?: `sha256:${string}`;
  image_digest?: string;
}

export interface FingerprintComparedEvent extends BaseEvent {
  type: 'fingerprint_compared';
  match: boolean;
  drifts: string[];
}

// v3.0 Assertion events
export interface AssertionStartedEvent extends BaseEvent {
  type: 'assertion_started';
  assertion_id: string;
  assertion_type: string;
  stability: string;
}

export interface AssertionRetriedEvent extends BaseEvent {
  type: 'assertion_retried';
  assertion_id: string;
  attempt: number;
  backoff_ms: number;
}

export interface AssertionPassedEvent extends BaseEvent {
  type: 'assertion_passed';
  assertion_id: string;
  assertion_type: string;
  attempts: number;
  duration_ms: number;
}

export interface AssertionFailedEvent extends BaseEvent {
  type: 'assertion_failed';
  assertion_id: string;
  assertion_type: string;
  attempts: number;
  expected: string;
  actual: string;
  diff?: string;
}

// v3.0 Drift events
export interface DriftDetectedEvent extends BaseEvent {
  type: 'drift_detected';
  drift_id: string;
  category: string;
  severity: string;
  repairable: boolean;
  repair_level: number | null;
}

export interface DriftBenignEvent extends BaseEvent {
  type: 'drift_benign';
  drift_id: string;
  changed_artifacts: string[];
  assertions_passed: boolean;
}

// v3.0 Repair Cascade events
export interface CascadeStartedEvent extends BaseEvent {
  type: 'cascade_started';
  drift_vectors: string[];
  total_levels: number;
}

export interface CascadeLevelStartedEvent extends BaseEvent {
  type: 'cascade_level_started';
  level: 1 | 2 | 3 | 4;
  strategy?: string;
}

export interface CascadeLevelPassedEvent extends BaseEvent {
  type: 'cascade_level_passed';
  level: 1 | 2 | 3 | 4;
  duration_ms: number;
  result: string;
}

export interface CascadeLevelFailedEvent extends BaseEvent {
  type: 'cascade_level_failed';
  level: 1 | 2 | 3 | 4;
  reason: string;
}

export interface RepairLLMCalledEvent extends BaseEvent {
  type: 'repair_llm_called';
  repair_id: string;
  prompt_hash: `sha256:${string}`;
  model: string;
  budget: { max_tokens: number; max_cost_usd: number; timeout_ms: number };
}

export interface RepairPlanReceivedEvent extends BaseEvent {
  type: 'repair_plan_received';
  repair_id: string;
  repaired_plan_hash: `sha256:${string}`;
  mutations: string[];
}

export interface RepairVerifiedEvent extends BaseEvent {
  type: 'repair_verified';
  repair_id: string;
  assertions_passed: number;
  assertions_total: number;
}

// v3.0 Lineage events
export interface GenerationCreatedEvent extends BaseEvent {
  type: 'generation_created';
  plan_hash: `sha256:${string}`;
  parent_hash?: `sha256:${string}`;
  generation: number;
  mutation_type: string;
}

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
  | ReplayDivergedEvent
  // v3.0 events
  | FingerprintCapturedEvent
  | FingerprintComparedEvent
  | AssertionStartedEvent
  | AssertionRetriedEvent
  | AssertionPassedEvent
  | AssertionFailedEvent
  | DriftDetectedEvent
  | DriftBenignEvent
  | CascadeStartedEvent
  | CascadeLevelStartedEvent
  | CascadeLevelPassedEvent
  | CascadeLevelFailedEvent
  | RepairLLMCalledEvent
  | RepairPlanReceivedEvent
  | RepairVerifiedEvent
  | GenerationCreatedEvent;

export type EventType = Event['type'];
