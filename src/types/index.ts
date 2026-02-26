export type {
  ExecutionPlan,
  ExecutionPlanV3,
  Step,
  CreateFileStep,
  RunCommandStep,
  PlannerSignature,
} from './execution-plan.js';

export { isPlanV3 } from './execution-plan.js';

export type { TaskSpec } from './task-spec.js';

export type {
  Event,
  EventType,
  RunStartEvent,
  RunCompleteEvent,
  RunFailedEvent,
  PlanGeneratedEvent,
  PlanCacheHitEvent,
  PlanCacheMissEvent,
  PlanLoadedEvent,
  StepStartEvent,
  StepCompleteEvent,
  StepFailedEvent,
  ArtifactHashedEvent,
  ReplayStartEvent,
  ReplayVerifiedEvent,
  ReplayDivergedEvent,
  // v3.0 events
  FingerprintCapturedEvent,
  FingerprintComparedEvent,
  AssertionStartedEvent,
  AssertionRetriedEvent,
  AssertionPassedEvent,
  AssertionFailedEvent,
  DriftDetectedEvent,
  DriftBenignEvent,
  CascadeStartedEvent,
  CascadeLevelStartedEvent,
  CascadeLevelPassedEvent,
  CascadeLevelFailedEvent,
  RepairLLMCalledEvent,
  RepairPlanReceivedEvent,
  RepairVerifiedEvent,
  GenerationCreatedEvent,
} from './events.js';

export type {
  RunSummary,
  RunStatus,
  StepResult,
  Environment,
} from './run-summary.js';

// v3.0 types
export type {
  Assertion,
  AssertionType,
  AssertionStability,
  AssertionSpec,
  AssertionResult,
  RetryPolicy,
  ExitCodeAssertionSpec,
  FileExistsAssertionSpec,
  FileHashAssertionSpec,
  FileContainsAssertionSpec,
  CommandOutputAssertionSpec,
  HttpResponseAssertionSpec,
  JsonSchemaAssertionSpec,
} from './assertion.js';

export type { ProtectedSurface } from './protected-surface.js';
export { DEFAULT_PROTECTED_SURFACE } from './protected-surface.js';

export type {
  PlanLineage,
  MutationType,
  RepairMutation,
  AppliedMutation,
} from './plan-lineage.js';

export type { PlanIOSignature } from './plan-io-signature.js';

export type { DependencyFingerprint } from './dependency-fingerprint.js';

export type {
  DriftVector,
  DriftCategory,
  DriftSeverity,
  DriftDetails,
} from './drift-vector.js';

export type {
  RepairRequest,
  RepairResponse,
  RepairConstraints,
  RepairBudget,
  RepairAction,
  RepairContext,
  RepairContextSnippet,
  DeterministicRepairStrategy,
} from './repair.js';

export {
  DEFAULT_REPAIR_BUDGET,
  DEFAULT_REPAIR_CONSTRAINTS,
} from './repair.js';
