export * from './types/index.js';

// v2.1 core exports (preserved)
export { hashString, hashBuffer, hashObject, computeCacheKey, computeRunHash } from './core/hasher.js';
export { canonicalJson } from './core/canonical-json.js';
export { validateExecutionPlan, assertValidPlan, validateTaskSpecData, validateEventData, validateRunSummaryData } from './core/validator.js';
export { EventLogger, createEvent } from './core/logger.js';
export { lookupPlan, storePlan, clearCache, clearExpired, getCacheStats, DEFAULT_CACHE_TTL_MS } from './core/plan-cache.js';
export { generatePlan, generatePlanWithUsage, estimateCost, SYSTEM_PROMPT_HASH } from './core/planner.js';
export type { PlanGenerationResult } from './core/planner.js';
export { executePlan, buildDependencyGraph, StepTimeoutError } from './core/executor.js';
export type { ExecutionOptions, ExecutionHooks, ProgressEvent } from './core/executor.js';
export { run, executeFromFile } from './core/runner.js';
export { replay } from './core/replayer.js';

// v3.0 core exports
export { executeAssertions } from './core/asserter.js';
export { captureDependencyFingerprint, compareDependencyFingerprints } from './core/fingerprint.js';
export {
  detectEnvironmentDrift,
  detectDependencyDrift,
  detectArtifactDrift,
  detectAssertionDrift,
  classifyDrifts,
} from './core/drift-detector.js';
export {
  createOriginalLineage,
  createBenignDriftGeneration,
  createDeterministicRepairGeneration,
  createLLMRepairGeneration,
  createManualEditGeneration,
  saveGeneration,
  loadLineage,
  loadGenerationPlan,
  getLineageChain,
} from './core/lineage.js';
export { executeCascade } from './core/repair-cascade.js';
export { STRATEGIES as REPAIR_STRATEGIES, findMatchingStrategies } from './core/repair-strategies.js';
export { retryFlakyAssertions } from './core/repair-retry.js';
export { repairWithLLM, extractJson } from './core/repair-compiler.js';
export { ForensicsRecorder, loadForensicsSummary, loadHttpRecords } from './core/forensics.js';
export type { HttpForensicsRecord, FsForensicsRecord, StepForensicsSummary, RunForensicsSummary } from './core/forensics.js';
export { diffForensics } from './core/forensics-diff.js';
export type { ForensicsDiffResult, StepForensicsDiff, HttpDiffEntry } from './core/forensics-diff.js';
export { loadTag, listTags, resolveTagOrHash } from './cli/freeze.js';
export type { PlanTag } from './cli/freeze.js';

// Plan bundles
export { exportBundle, saveBundleToFile, loadBundleFromFile, importBundle } from './core/plan-bundle.js';
export type { PlanBundle } from './core/plan-bundle.js';

// IO Signature
export { inferIOSignature, validateIOSignature } from './core/io-signature.js';

// v3.1: Config, Dry-Run, Preflight, Retention, Watch
export { loadConfig, loadConfigFile, findConfigFile, resolveConfig, listProfiles, DEFAULT_CONFIG } from './core/config.js';
export type { ContinuumConfig, ResolvedConfig } from './core/config.js';
export { analyzePlan, computeLayers } from './core/dry-run.js';
export type { DryRunResult, DryRunStepPreview } from './core/dry-run.js';
export { runPreflight } from './core/preflight.js';
export type { CheckResult, CheckStatus, ValidationReport } from './core/preflight.js';
export { findCleanupTargets, executeCleanup, cleanup } from './core/retention.js';
export type { CleanupTarget, CleanupResult, CleanupOptions } from './core/retention.js';
export { watchDirectory, matchGlob } from './core/watcher.js';

// v3.2: Templates, Plan Diff
export { extractVariables, validateVariables, applyTemplate } from './core/template.js';
export { diffPlans, formatPlanDiff } from './core/plan-diff.js';
export type { PlanDiffResult, StepDiff, FieldDiff, ChangeType } from './core/plan-diff.js';

// v3.3: Migration, Doctor, Webhooks
export { migratePlan, needsMigration, migrationWarnings } from './core/migrate.js';
export { runDoctor } from './core/doctor.js';
export type { DoctorCheck, DoctorReport } from './core/doctor.js';
export { sendWebhook, sendAllWebhooks, buildPayload, mapStatusToEvent } from './core/webhook.js';
export type { WebhookConfig, WebhookPayload, WebhookEventType } from './core/webhook.js';

// v3.5: Token tracking, Query, Step cache, Status, Plugins
export { queryRuns, computeRunStats } from './storage/query.js';
export type { RunQuery, RunStats } from './storage/query.js';
export { computeStepInputHash, lookupStepCache, storeStepCache, clearStepCache, getStepCacheStats } from './core/step-cache.js';
export type { StepCacheEntry } from './core/step-cache.js';
export { getSystemStatus, formatStatus } from './core/status.js';
export type { SystemStatus, RecentRun } from './core/status.js';
export { PluginRegistry, globalRegistry } from './core/plugin.js';
export type { ContinuumPlugin, BeforePlanContext, AfterPlanContext, BeforeStepContext, AfterStepContext } from './core/plugin.js';

// v3.6: Lint, Structured Log, Compare, Annotations, Search
export { lintPlan, formatLintResult } from './core/lint.js';
export type { LintFinding, LintResult, LintSeverity } from './core/lint.js';
export { StructuredLogger, eventsToStructuredLog, stdoutSink, createArraySink } from './core/structured-log.js';
export type { StructuredLogEntry, LogLevel, LogSink } from './core/structured-log.js';
export { compareRuns, formatComparison } from './core/run-compare.js';
export type { RunComparison, RunBrief, StepComparison, TokenDelta } from './core/run-compare.js';
export { addAnnotation, loadAnnotations, getStepAnnotations, removeAnnotation, searchAnnotations } from './core/annotations.js';
export type { StepAnnotation, RunAnnotations } from './core/annotations.js';
export { searchRuns } from './core/search.js';
export type { SearchResult, SearchOptions } from './core/search.js';

// v3.7: Rate Limiter, Checkpoints, Metrics, Timeline, Notifications
export { RateLimiter, RateLimitExceededError } from './core/rate-limiter.js';
export type { RateLimiterConfig, RateLimiterStats } from './core/rate-limiter.js';
export { saveCheckpoint, loadCheckpoint, removeCheckpoint, hasCheckpoint, getRemainingSteps, validateCheckpoint } from './core/checkpoint.js';
export type { ExecutionCheckpoint } from './core/checkpoint.js';
export { computeMetrics, formatMetrics } from './core/metrics.js';
export type { AggregateMetrics, MetricsOptions } from './core/metrics.js';
export { buildTimeline, formatTimeline } from './core/timeline.js';
export type { RunTimeline, TimelineEntry } from './core/timeline.js';
export { sendNotifications } from './core/notifications.js';
export type { NotificationChannelConfig, DesktopChannelConfig, EmailChannelConfig, JsonFileChannelConfig, NotificationResult } from './core/notifications.js';

// v3.8: Export, Archive, Profiler, DOT Graph, Run Tags
export { exportRuns } from './core/export.js';
export type { ExportFormat, ExportOptions } from './core/export.js';
export { archiveRuns, restoreArchive, listArchives, deleteArchive } from './core/archive.js';
export type { ArchiveManifest } from './core/archive.js';
export { StepProfiler, captureSnapshot, formatProfile } from './core/profiler.js';
export type { StepProfile, RunProfile, ResourceSnapshot } from './core/profiler.js';
export { planToDot } from './core/dot-graph.js';
export type { DotGraphOptions } from './core/dot-graph.js';
export { tagRun, untagRun, getRunTags, getRunsByTag, listTags as listRunTags, deleteTag, renameTag } from './core/run-tags.js';

// v3.9: Deep Validation, Step Aliasing, Audit Log, Narrative, Policies
export { deepValidatePlan, formatDeepValidation } from './core/deep-validate.js';
export type { DeepValidationReport, DeepValidationFinding, DeepValidationSeverity } from './core/deep-validate.js';
export { buildAliasMap, resolveAliases, resolveStepRef, listAliases } from './core/step-alias.js';
export type { AliasMap } from './core/step-alias.js';
export { audit, readAuditLog, streamAuditLog, getAuditTrail, formatAuditLog } from './core/audit-log.js';
export type { AuditAction, AuditEntry, AuditQueryOptions } from './core/audit-log.js';
export { generateNarrative } from './core/narrative.js';
export { buildPolicyRules, evaluatePolicies, formatViolations, describePolicy } from './core/policy.js';
export type { ExecutionPolicy, PolicyRule, PolicyContext, PolicyViolation } from './core/policy.js';

// v4.0: Step I/O, Workspace Snapshots, Plan Optimizer, Workspace Diff, Breakpoints
export { buildOutputRegistry, resolveInputs, validateStepIO, inferDependencies, listStepIO } from './core/step-io.js';
export type { StepOutput, StepInput, StepWithIO, OutputRegistry } from './core/step-io.js';
export { takeSnapshot, rollbackToSnapshot, diffSnapshot, loadSnapshot, listSnapshots, deleteSnapshot } from './core/workspace-snapshot.js';
export type { WorkspaceSnapshot, SnapshotFileEntry, SnapshotOptions } from './core/workspace-snapshot.js';
export { optimizePlan, formatOptimization } from './core/plan-optimizer.js';
export type { Optimization, OptimizationResult } from './core/plan-optimizer.js';
export { diffWorkspaces, formatWorkspaceDiff } from './core/workspace-diff.js';
export type { FileDiff, LineDiff, WorkspaceDiffResult } from './core/workspace-diff.js';
export { BreakpointManager, createLoggingHandler, createSkipHandler, createAbortHandler, formatBreakpointState } from './core/breakpoint.js';
export type { BreakpointAction, BreakpointState, BreakpointHandler, BreakpointConfig } from './core/breakpoint.js';

// v4.1: Middleware, Plan Versioning, Resource Limiter, Run Queue, Output Transformers
export { MiddlewarePipeline, createLoggingMiddleware, createEnvMiddleware, createTimingMiddleware, createSkipMiddleware, createMiddlewareContext } from './core/middleware.js';
export type { MiddlewareContext, StepMiddleware } from './core/middleware.js';
export { createPlanVersion, loadPlanHistory, loadPlanVersion, computeSemanticDiff, formatPlanHistory } from './core/plan-version.js';
export type { PlanVersion, PlanChange, PlanHistory } from './core/plan-version.js';
export { ResourceLimiter } from './core/resource-limiter.js';
export type { ResourceLimits, ResourceUsage, LimitCheck } from './core/resource-limiter.js';
export { enqueueRun, dequeueNext, completeQueuedRun, failQueuedRun, cancelQueuedRun, reprioritizeRun, listQueue, getQueueStats, purgeQueue, formatQueue, loadQueue } from './core/run-queue.js';
export type { RunPriority, QueuedRunStatus, QueuedRun, QueueState } from './core/run-queue.js';
export { applyTransformers, registerTransformer, unregisterTransformer, formatTransformResult } from './core/output-transformer.js';
export type { OutputTransformer, TransformResult } from './core/output-transformer.js';

// v3.4: Init, Conditions, Compose
export { initProject, generateDefaultConfig } from './core/init.js';
export type { InitOptions, InitResult } from './core/init.js';
export { evaluateCondition } from './core/condition.js';
export type { ConditionContext } from './core/condition.js';
export { composePlans } from './core/compose.js';
export type { ComposeOptions, ComposeResult } from './core/compose.js';

// Sandboxes
export type { Sandbox, ExecResult, ExecOptions } from './sandbox/types.js';
export { LocalSandbox } from './sandbox/local.js';
export { DockerSandbox } from './sandbox/docker.js';
