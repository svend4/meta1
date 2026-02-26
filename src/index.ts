export * from './types/index.js';

// v2.1 core exports (preserved)
export { hashString, hashBuffer, hashObject, computeCacheKey, computeRunHash } from './core/hasher.js';
export { canonicalJson } from './core/canonical-json.js';
export { validateExecutionPlan, assertValidPlan, validateTaskSpecData, validateEventData, validateRunSummaryData } from './core/validator.js';
export { EventLogger, createEvent } from './core/logger.js';
export { lookupPlan, storePlan, clearCache } from './core/plan-cache.js';
export { generatePlan, SYSTEM_PROMPT_HASH } from './core/planner.js';
export { executePlan } from './core/executor.js';
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
  saveGeneration,
  loadLineage,
  loadGenerationPlan,
  getLineageChain,
} from './core/lineage.js';
export { executeCascade } from './core/repair-cascade.js';
export { STRATEGIES as REPAIR_STRATEGIES, findMatchingStrategies } from './core/repair-strategies.js';
export { retryFlakyAssertions } from './core/repair-retry.js';
export { repairWithLLM } from './core/repair-compiler.js';

// Sandboxes
export type { Sandbox, ExecResult } from './sandbox/types.js';
export { LocalSandbox } from './sandbox/local.js';
export { DockerSandbox } from './sandbox/docker.js';
