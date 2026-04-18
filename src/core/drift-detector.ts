import { randomUUID } from 'node:crypto';
import type { DriftVector, DriftCategory, DriftSeverity } from '../types/drift-vector.js';
import type { DependencyFingerprint } from '../types/dependency-fingerprint.js';
import type { AssertionResult } from '../types/assertion.js';
import type { StepResult } from '../types/run-summary.js';
import type { ProtectedSurface } from '../types/protected-surface.js';
import type { Step } from '../types/execution-plan.js';
import { DEFAULT_PROTECTED_SURFACE } from '../types/protected-surface.js';

/** Parse semver into [major, minor, patch] */
function parseSemver(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

/** Check if a path matches any pattern in a list (simple glob matching) */
function pathMatchesPatterns(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      if (path.startsWith(prefix + '/') || path === prefix) return true;
    } else if (pattern === path) {
      return true;
    } else if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '[^/]*').replace(/\*\*/g, '.*') + '$');
      if (regex.test(path)) return true;
    }
  }
  return false;
}

/** Detect environment/tool version drifts between fingerprints */
export function detectEnvironmentDrift(
  original: DependencyFingerprint,
  current: DependencyFingerprint,
  runId: string,
  sourceRunId: string,
): DriftVector[] {
  const drifts: DriftVector[] = [];

  const toolPairs: Array<{ key: string; orig: string | undefined; curr: string | undefined }> = [
    { key: 'node', orig: original.tools.node, curr: current.tools.node },
    { key: 'npm', orig: original.tools.npm, curr: current.tools.npm },
    { key: 'git', orig: original.tools.git, curr: current.tools.git },
    { key: 'docker', orig: original.tools.docker, curr: current.tools.docker },
  ];

  for (const { key, orig, curr } of toolPairs) {
    if (!orig || !curr || orig === curr) continue;

    const origSemver = parseSemver(orig);
    const currSemver = parseSemver(curr);

    let severity: DriftSeverity = 'degraded';
    let repairable = true;
    let repairLevel: 1 | 2 | 3 | null = 2;

    if (origSemver && currSemver) {
      if (origSemver[0] !== currSemver[0]) {
        // Major version change
        severity = 'blocking';
        repairable = false;
        repairLevel = null;
      } else if (origSemver[1] !== currSemver[1]) {
        severity = 'degraded';
      }
    }

    drifts.push({
      drift_id: randomUUID(),
      detected_at: new Date().toISOString(),
      run_id: runId,
      source_run_id: sourceRunId,
      category: 'environment',
      severity,
      repairable,
      repair_level: repairLevel,
      details: {
        step_id: '',
        step_order: -1,
        expected: orig,
        actual: curr,
        env_key: key,
        frozen_value: orig,
        current_value: curr,
      },
    });
  }

  return drifts;
}

/** Detect dependency drifts between fingerprints */
export function detectDependencyDrift(
  original: DependencyFingerprint,
  current: DependencyFingerprint,
  runId: string,
  sourceRunId: string,
): DriftVector[] {
  const drifts: DriftVector[] = [];

  // Lockfile drift
  if (original.lockfile && current.lockfile && original.lockfile.hash !== current.lockfile.hash) {
    drifts.push({
      drift_id: randomUUID(),
      detected_at: new Date().toISOString(),
      run_id: runId,
      source_run_id: sourceRunId,
      category: 'dependency',
      severity: 'cosmetic',
      repairable: true,
      repair_level: 2,
      details: {
        step_id: '',
        step_order: -1,
        expected: original.lockfile.hash,
        actual: current.lockfile.hash,
        diff: `Lockfile ${original.lockfile.path} hash changed`,
      },
    });
  }

  // Sandbox image drift
  if (original.sandbox_image && current.sandbox_image &&
      original.sandbox_image.digest !== current.sandbox_image.digest) {
    drifts.push({
      drift_id: randomUUID(),
      detected_at: new Date().toISOString(),
      run_id: runId,
      source_run_id: sourceRunId,
      category: 'dependency',
      severity: 'degraded',
      repairable: true,
      repair_level: 2,
      details: {
        step_id: '',
        step_order: -1,
        expected: original.sandbox_image.digest,
        actual: current.sandbox_image.digest,
        diff: `Sandbox image digest changed`,
      },
    });
  }

  return drifts;
}

/** Detect artifact hash drifts between original and replay, respecting protected surface */
export function detectArtifactDrift(
  originalSteps: StepResult[],
  replaySteps: StepResult[],
  planSteps: Step[],
  surface: ProtectedSurface | undefined,
  runId: string,
  sourceRunId: string,
): DriftVector[] {
  const drifts: DriftVector[] = [];
  const effectiveSurface = surface ?? DEFAULT_PROTECTED_SURFACE;

  for (let i = 0; i < replaySteps.length; i++) {
    const replay = replaySteps[i];
    const original = originalSteps.find((s) => s.step_id === replay.step_id);
    const planStep = planSteps.find((s) => s.step_id === replay.step_id);

    if (!original?.artifact_hash || !replay.artifact_hash) continue;
    if (original.artifact_hash === replay.artifact_hash) continue;

    // Determine path for protected surface check
    const path = planStep && 'path' in planStep ? (planStep as { path: string }).path : '';
    const isProtected = path && pathMatchesPatterns(path, effectiveSurface.protected_paths);
    const isDriftable = path && pathMatchesPatterns(path, effectiveSurface.driftable_paths);

    let category: DriftCategory = 'artifact';
    let severity: DriftSeverity = 'degraded';
    let repairable = true;
    let repairLevel: 1 | 2 | 3 | null = 3;

    if (isProtected) {
      category = 'artifact_protected';
      severity = 'blocking';
      repairLevel = 3;
    } else if (isDriftable) {
      // Will be resolved by benign drift check if assertions pass
      severity = 'cosmetic';
    } else {
      // Not listed — follow step determinism
      if (planStep?.determinism === 'guaranteed') {
        severity = 'blocking';
      } else {
        severity = 'cosmetic';
      }
    }

    drifts.push({
      drift_id: randomUUID(),
      detected_at: new Date().toISOString(),
      run_id: runId,
      source_run_id: sourceRunId,
      category,
      severity,
      repairable,
      repair_level: repairLevel,
      details: {
        step_id: replay.step_id,
        step_order: i,
        expected: original.artifact_hash,
        actual: replay.artifact_hash,
        protected_path: isProtected ? path : undefined,
      },
    });
  }

  return drifts;
}

/** Detect assertion drifts from failed assertions */
export function detectAssertionDrift(
  assertionResults: AssertionResult[],
  runId: string,
  sourceRunId: string,
): DriftVector[] {
  const drifts: DriftVector[] = [];

  for (const result of assertionResults) {
    if (result.passed) continue;

    let category: DriftCategory;
    let severity: DriftSeverity;
    let repairLevel: 1 | 2 | 3 | null;

    switch (result.stability) {
      case 'stable':
        category = 'assertion_stable';
        severity = 'blocking';
        repairLevel = 3;
        break;
      case 'flaky':
        category = 'assertion_flaky';
        severity = 'degraded';
        repairLevel = 1;
        break;
      case 'environmental':
        category = 'assertion_environmental';
        severity = 'degraded';
        repairLevel = 1;
        break;
    }

    drifts.push({
      drift_id: randomUUID(),
      detected_at: new Date().toISOString(),
      run_id: runId,
      source_run_id: sourceRunId,
      category,
      severity,
      repairable: true,
      repair_level: repairLevel,
      details: {
        step_id: '',
        step_order: -1,
        expected: result.expected,
        actual: result.actual,
        diff: result.diff,
        assertion_id: result.assertion_id,
        assertion_type: result.type,
        assertion_stability: result.stability,
      },
    });
  }

  return drifts;
}

/** Classify all drift vectors and determine overall verdict */
export function classifyDrifts(
  artifactDrifts: DriftVector[],
  assertionDrifts: DriftVector[],
  assertionsAllPassed: boolean,
): {
  verdict: 'identical' | 'benign_drift' | 'drifted';
  blockingDrifts: DriftVector[];
  benignDrifts: DriftVector[];
} {
  // No artifact drift and no assertion failures → identical
  if (artifactDrifts.length === 0 && assertionDrifts.length === 0) {
    return { verdict: 'identical', blockingDrifts: [], benignDrifts: [] };
  }

  // Protected artifact drifts are always blocking regardless of assertions
  const protectedDrifts = artifactDrifts.filter((d) => d.category === 'artifact_protected');

  // If any assertions failed, it's drifted
  if (!assertionsAllPassed || protectedDrifts.length > 0) {
    const allDrifts = [...artifactDrifts, ...assertionDrifts];
    const blocking = allDrifts.filter((d) => d.severity === 'blocking');
    return {
      verdict: 'drifted',
      blockingDrifts: blocking.length > 0 ? blocking : allDrifts,
      benignDrifts: [],
    };
  }

  // Hashes differ but assertions pass and no protected paths affected → benign_drift
  if (artifactDrifts.length > 0 && assertionsAllPassed) {
    return {
      verdict: 'benign_drift',
      blockingDrifts: [],
      benignDrifts: artifactDrifts,
    };
  }

  return { verdict: 'identical', blockingDrifts: [], benignDrifts: [] };
}
