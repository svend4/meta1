import { describe, it, expect } from 'vitest';
import {
  detectEnvironmentDrift,
  detectDependencyDrift,
  detectArtifactDrift,
  detectAssertionDrift,
  classifyDrifts,
} from '../../src/core/drift-detector.js';
import type { DependencyFingerprint } from '../../src/types/dependency-fingerprint.js';
import type { AssertionResult } from '../../src/types/assertion.js';
import type { StepResult } from '../../src/types/run-summary.js';
import type { Step } from '../../src/types/execution-plan.js';
import type { DriftVector } from '../../src/types/drift-vector.js';

const RUN_ID = 'replay-run';
const SOURCE_RUN_ID = 'original-run';

function makeFp(overrides?: Partial<DependencyFingerprint>): DependencyFingerprint {
  return {
    fingerprint_id: 'fp-1',
    captured_at: new Date().toISOString(),
    fingerprint_hash: 'sha256:0000' as `sha256:${string}`,
    tools: { node: '20.11.0', npm: '10.2.0' },
    ...overrides,
  };
}

describe('detectEnvironmentDrift', () => {
  it('returns empty when all versions match', () => {
    const orig = makeFp();
    const curr = makeFp();
    const drifts = detectEnvironmentDrift(orig, curr, RUN_ID, SOURCE_RUN_ID);
    expect(drifts).toHaveLength(0);
  });

  it('detects minor node version change as degraded', () => {
    const orig = makeFp({ tools: { node: '20.11.0', npm: '10.2.0' } });
    const curr = makeFp({ tools: { node: '20.12.0', npm: '10.2.0' } });
    const drifts = detectEnvironmentDrift(orig, curr, RUN_ID, SOURCE_RUN_ID);

    expect(drifts).toHaveLength(1);
    expect(drifts[0].category).toBe('environment');
    expect(drifts[0].severity).toBe('degraded');
    expect(drifts[0].details.env_key).toBe('node');
  });

  it('detects major node version change as blocking', () => {
    const orig = makeFp({ tools: { node: '20.11.0', npm: '10.2.0' } });
    const curr = makeFp({ tools: { node: '22.0.0', npm: '10.2.0' } });
    const drifts = detectEnvironmentDrift(orig, curr, RUN_ID, SOURCE_RUN_ID);

    expect(drifts).toHaveLength(1);
    expect(drifts[0].severity).toBe('blocking');
    expect(drifts[0].repairable).toBe(false);
  });

  it('detects multiple tool version changes', () => {
    const orig = makeFp({ tools: { node: '20.11.0', npm: '10.2.0', git: '2.40.0' } });
    const curr = makeFp({ tools: { node: '20.12.0', npm: '10.3.0', git: '2.41.0' } });
    const drifts = detectEnvironmentDrift(orig, curr, RUN_ID, SOURCE_RUN_ID);

    expect(drifts).toHaveLength(3);
  });

  it('skips undefined tools', () => {
    const orig = makeFp({ tools: { node: '20.0.0', npm: '10.0.0' } });
    const curr = makeFp({ tools: { node: '20.0.0', npm: '10.0.0', docker: '24.0.0' } });
    // docker is undefined in orig, so no drift
    const drifts = detectEnvironmentDrift(orig, curr, RUN_ID, SOURCE_RUN_ID);
    expect(drifts).toHaveLength(0);
  });
});

describe('detectDependencyDrift', () => {
  it('returns empty when no lockfiles present', () => {
    const orig = makeFp();
    const curr = makeFp();
    const drifts = detectDependencyDrift(orig, curr, RUN_ID, SOURCE_RUN_ID);
    expect(drifts).toHaveLength(0);
  });

  it('detects lockfile hash change', () => {
    const orig = makeFp({
      lockfile: { path: 'package-lock.json', hash: 'sha256:aaa' as `sha256:${string}`, format: 'npm' },
    });
    const curr = makeFp({
      lockfile: { path: 'package-lock.json', hash: 'sha256:bbb' as `sha256:${string}`, format: 'npm' },
    });
    const drifts = detectDependencyDrift(orig, curr, RUN_ID, SOURCE_RUN_ID);

    expect(drifts).toHaveLength(1);
    expect(drifts[0].category).toBe('dependency');
    expect(drifts[0].severity).toBe('cosmetic');
  });

  it('detects sandbox image digest change', () => {
    const orig = makeFp({
      sandbox_image: { name: 'node:20-slim', digest: 'sha256:old-digest' },
    });
    const curr = makeFp({
      sandbox_image: { name: 'node:20-slim', digest: 'sha256:new-digest' },
    });
    const drifts = detectDependencyDrift(orig, curr, RUN_ID, SOURCE_RUN_ID);

    expect(drifts).toHaveLength(1);
    expect(drifts[0].category).toBe('dependency');
    expect(drifts[0].severity).toBe('degraded');
  });
});

describe('detectArtifactDrift', () => {
  it('returns empty when all hashes match', () => {
    const origSteps: StepResult[] = [
      { step_id: 's1', type: 'create_file', status: 'completed', artifact_hash: 'sha256:aaa' as `sha256:${string}` },
    ];
    const replaySteps: StepResult[] = [
      { step_id: 's1', type: 'create_file', status: 'completed', artifact_hash: 'sha256:aaa' as `sha256:${string}` },
    ];
    const planSteps: Step[] = [
      { step_id: 's1', type: 'create_file', description: 'test', path: 'test.txt', content: 'x', determinism: 'guaranteed' },
    ];

    const drifts = detectArtifactDrift(origSteps, replaySteps, planSteps, undefined, RUN_ID, SOURCE_RUN_ID);
    expect(drifts).toHaveLength(0);
  });

  it('detects hash change in guaranteed determinism step as blocking', () => {
    const origSteps: StepResult[] = [
      { step_id: 's1', type: 'create_file', status: 'completed', artifact_hash: 'sha256:aaa' as `sha256:${string}` },
    ];
    const replaySteps: StepResult[] = [
      { step_id: 's1', type: 'create_file', status: 'completed', artifact_hash: 'sha256:bbb' as `sha256:${string}` },
    ];
    const planSteps: Step[] = [
      { step_id: 's1', type: 'create_file', description: 'test', path: 'test.txt', content: 'x', determinism: 'guaranteed' },
    ];

    const drifts = detectArtifactDrift(origSteps, replaySteps, planSteps, undefined, RUN_ID, SOURCE_RUN_ID);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].severity).toBe('blocking');
  });

  it('treats best_effort step drift as cosmetic', () => {
    const origSteps: StepResult[] = [
      { step_id: 's1', type: 'run_command', status: 'completed', artifact_hash: 'sha256:aaa' as `sha256:${string}` },
    ];
    const replaySteps: StepResult[] = [
      { step_id: 's1', type: 'run_command', status: 'completed', artifact_hash: 'sha256:bbb' as `sha256:${string}` },
    ];
    const planSteps: Step[] = [
      { step_id: 's1', type: 'run_command', description: 'test', command: 'date', args: [], determinism: 'best_effort' },
    ];

    const drifts = detectArtifactDrift(origSteps, replaySteps, planSteps, undefined, RUN_ID, SOURCE_RUN_ID);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].severity).toBe('cosmetic');
  });
});

describe('detectAssertionDrift', () => {
  it('returns empty when all assertions pass', () => {
    const results: AssertionResult[] = [
      { assertion_id: 'a1', type: 'file_exists', stability: 'stable', passed: true, attempts: 1, duration_ms: 10, expected: 'exists', actual: 'exists' },
    ];
    const drifts = detectAssertionDrift(results, RUN_ID, SOURCE_RUN_ID);
    expect(drifts).toHaveLength(0);
  });

  it('classifies stable assertion failure as blocking', () => {
    const results: AssertionResult[] = [
      { assertion_id: 'a1', type: 'exit_code', stability: 'stable', passed: false, attempts: 1, duration_ms: 10, expected: 'exit 0', actual: 'exit 1' },
    ];
    const drifts = detectAssertionDrift(results, RUN_ID, SOURCE_RUN_ID);

    expect(drifts).toHaveLength(1);
    expect(drifts[0].category).toBe('assertion_stable');
    expect(drifts[0].severity).toBe('blocking');
    expect(drifts[0].repair_level).toBe(3);
  });

  it('classifies flaky assertion failure as degraded', () => {
    const results: AssertionResult[] = [
      { assertion_id: 'a1', type: 'http_response', stability: 'flaky', passed: false, attempts: 3, duration_ms: 6000, expected: 'HTTP 200', actual: 'HTTP 503' },
    ];
    const drifts = detectAssertionDrift(results, RUN_ID, SOURCE_RUN_ID);

    expect(drifts).toHaveLength(1);
    expect(drifts[0].category).toBe('assertion_flaky');
    expect(drifts[0].severity).toBe('degraded');
    expect(drifts[0].repair_level).toBe(1);
  });

  it('classifies environmental assertion failure as degraded', () => {
    const results: AssertionResult[] = [
      { assertion_id: 'a1', type: 'command_output', stability: 'environmental', passed: false, attempts: 2, duration_ms: 3000, expected: 'v20', actual: 'v22' },
    ];
    const drifts = detectAssertionDrift(results, RUN_ID, SOURCE_RUN_ID);

    expect(drifts).toHaveLength(1);
    expect(drifts[0].category).toBe('assertion_environmental');
    expect(drifts[0].repair_level).toBe(1);
  });
});

describe('classifyDrifts', () => {
  it('returns identical when no drifts', () => {
    const result = classifyDrifts([], [], true);
    expect(result.verdict).toBe('identical');
  });

  it('returns benign_drift when artifacts differ but assertions pass', () => {
    const artifactDrifts: DriftVector[] = [{
      drift_id: '1',
      detected_at: new Date().toISOString(),
      run_id: RUN_ID,
      source_run_id: SOURCE_RUN_ID,
      category: 'artifact',
      severity: 'cosmetic',
      repairable: true,
      repair_level: 3,
      details: { step_id: 's1', step_order: 0, expected: 'sha256:aaa', actual: 'sha256:bbb' },
    }];

    const result = classifyDrifts(artifactDrifts, [], true);
    expect(result.verdict).toBe('benign_drift');
    expect(result.benignDrifts).toHaveLength(1);
  });

  it('returns drifted when assertions fail', () => {
    const assertionDrifts: DriftVector[] = [{
      drift_id: '1',
      detected_at: new Date().toISOString(),
      run_id: RUN_ID,
      source_run_id: SOURCE_RUN_ID,
      category: 'assertion_stable',
      severity: 'blocking',
      repairable: true,
      repair_level: 3,
      details: { step_id: '', step_order: -1, expected: 'exit 0', actual: 'exit 1' },
    }];

    const result = classifyDrifts([], assertionDrifts, false);
    expect(result.verdict).toBe('drifted');
    expect(result.blockingDrifts.length).toBeGreaterThan(0);
  });

  it('returns drifted for protected artifact change even if assertions pass', () => {
    const artifactDrifts: DriftVector[] = [{
      drift_id: '1',
      detected_at: new Date().toISOString(),
      run_id: RUN_ID,
      source_run_id: SOURCE_RUN_ID,
      category: 'artifact_protected',
      severity: 'blocking',
      repairable: true,
      repair_level: 3,
      details: { step_id: 's1', step_order: 0, expected: 'sha256:aaa', actual: 'sha256:bbb', protected_path: 'src/index.ts' },
    }];

    const result = classifyDrifts(artifactDrifts, [], true);
    expect(result.verdict).toBe('drifted');
  });
});
