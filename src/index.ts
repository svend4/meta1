export * from './types/index.js';

// v2.1 core exports (preserved)
export { hashString, hashBuffer, hashObject, computeCacheKey, computeRunHash } from './core/hasher.js';
export { canonicalJson } from './core/canonical-json.js';
export { validateExecutionPlan, assertValidPlan, validateTaskSpecData, validateEventData, validateRunSummaryData } from './core/validator.js';
export { EventLogger, createEvent } from './core/logger.js';
export { lookupPlan, storePlan, clearCache, clearExpired, getCacheStats, DEFAULT_CACHE_TTL_MS } from './core/plan-cache.js';
export { generatePlan, SYSTEM_PROMPT_HASH } from './core/planner.js';
export { executePlan, buildDependencyGraph } from './core/executor.js';
export type { ExecutionOptions } from './core/executor.js';
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
export { loadConfig, loadConfigFile, findConfigFile, resolveConfig, DEFAULT_CONFIG } from './core/config.js';
export type { ContinuumConfig, ResolvedConfig } from './core/config.js';
export { analyzePlan, computeLayers } from './core/dry-run.js';
export type { DryRunResult, DryRunStepPreview } from './core/dry-run.js';
export { runPreflight } from './core/preflight.js';
export type { CheckResult, CheckStatus, ValidationReport } from './core/preflight.js';
export { findCleanupTargets, executeCleanup, cleanup } from './core/retention.js';
export type { CleanupTarget, CleanupResult, CleanupOptions } from './core/retention.js';
export { watchDirectory, matchGlob } from './core/watcher.js';

// Sandboxes
export type { Sandbox, ExecResult } from './sandbox/types.js';
export { LocalSandbox } from './sandbox/local.js';
export { DockerSandbox } from './sandbox/docker.js';
