/** Drift category classification */
export type DriftCategory =
  | 'environment'
  | 'dependency'
  | 'artifact'
  | 'artifact_protected'
  | 'assertion_stable'
  | 'assertion_flaky'
  | 'assertion_environmental'
  | 'permission'
  | 'timeout'
  | 'missing_input'
  | 'tool_unavailable';

/** Drift severity levels */
export type DriftSeverity = 'blocking' | 'degraded' | 'cosmetic';

/** Structured drift details */
export interface DriftDetails {
  step_id: string;
  step_order: number;
  expected: string;
  actual: string;
  diff?: string;
  env_key?: string;
  frozen_value?: string;
  current_value?: string;
  package_name?: string;
  expected_version?: string;
  resolved_version?: string;
  assertion_id?: string;
  assertion_type?: string;
  assertion_stability?: string;
  protected_path?: string;
}

/** A structured description of how reality diverged */
export interface DriftVector {
  drift_id: string;
  detected_at: string;
  run_id: string;
  source_run_id: string;
  category: DriftCategory;
  severity: DriftSeverity;
  repairable: boolean;
  repair_level: 1 | 2 | 3 | null;
  details: DriftDetails;
}
