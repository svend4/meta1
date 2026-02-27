import { loadForensicsSummary, loadHttpRecords } from './forensics.js';

export interface StepForensicsDiff {
  step_id: string;
  http_calls: { a: number; b: number };
  fs_operations: { a: number; b: number };
  duration_ms: { a: number; b: number };
  new_errors: string[];
  resolved_errors: string[];
}

export interface HttpDiffEntry {
  method: string;
  url: string;
  only_in: 'a' | 'b';
  status?: number;
  duration_ms?: number;
}

export interface ForensicsDiffResult {
  run_a: string;
  run_b: string;
  steps: StepForensicsDiff[];
  http_diff: HttpDiffEntry[];
  summary: {
    steps_changed: number;
    http_calls_delta: number;
    fs_ops_delta: number;
    new_errors: number;
    resolved_errors: number;
  };
}

/**
 * Compare forensics data between two runs.
 * Returns detailed diff of HTTP calls, FS operations, and errors.
 */
export function diffForensics(runIdA: string, runIdB: string): ForensicsDiffResult {
  const summaryA = loadForensicsSummary(runIdA);
  const summaryB = loadForensicsSummary(runIdB);

  if (!summaryA && !summaryB) {
    return {
      run_a: runIdA,
      run_b: runIdB,
      steps: [],
      http_diff: [],
      summary: { steps_changed: 0, http_calls_delta: 0, fs_ops_delta: 0, new_errors: 0, resolved_errors: 0 },
    };
  }

  const stepsA = new Map((summaryA?.steps ?? []).map((s) => [s.step_id, s]));
  const stepsB = new Map((summaryB?.steps ?? []).map((s) => [s.step_id, s]));
  const allStepIds = new Set([...stepsA.keys(), ...stepsB.keys()]);

  const stepDiffs: StepForensicsDiff[] = [];
  let stepsChanged = 0;

  for (const stepId of allStepIds) {
    const a = stepsA.get(stepId);
    const b = stepsB.get(stepId);

    const errorsA = new Set(a?.errors ?? []);
    const errorsB = new Set(b?.errors ?? []);

    const newErrors = [...errorsB].filter((e) => !errorsA.has(e));
    const resolvedErrors = [...errorsA].filter((e) => !errorsB.has(e));

    const diff: StepForensicsDiff = {
      step_id: stepId,
      http_calls: { a: a?.http_calls ?? 0, b: b?.http_calls ?? 0 },
      fs_operations: { a: a?.fs_operations ?? 0, b: b?.fs_operations ?? 0 },
      duration_ms: { a: a?.total_duration_ms ?? 0, b: b?.total_duration_ms ?? 0 },
      new_errors: newErrors,
      resolved_errors: resolvedErrors,
    };

    if (diff.http_calls.a !== diff.http_calls.b ||
        diff.fs_operations.a !== diff.fs_operations.b ||
        newErrors.length > 0 ||
        resolvedErrors.length > 0) {
      stepsChanged++;
    }

    stepDiffs.push(diff);
  }

  // Diff HTTP records by method+url
  const httpA = loadHttpRecords(runIdA);
  const httpB = loadHttpRecords(runIdB);

  const httpKeyA = new Set(httpA.map((r) => `${r.method}:${r.url}`));
  const httpKeyB = new Set(httpB.map((r) => `${r.method}:${r.url}`));

  const httpDiff: HttpDiffEntry[] = [];

  for (const record of httpA) {
    const key = `${record.method}:${record.url}`;
    if (!httpKeyB.has(key)) {
      httpDiff.push({
        method: record.method,
        url: record.url,
        only_in: 'a',
        status: record.response.status,
        duration_ms: record.duration_ms,
      });
    }
  }

  for (const record of httpB) {
    const key = `${record.method}:${record.url}`;
    if (!httpKeyA.has(key)) {
      httpDiff.push({
        method: record.method,
        url: record.url,
        only_in: 'b',
        status: record.response.status,
        duration_ms: record.duration_ms,
      });
    }
  }

  const totalNewErrors = stepDiffs.reduce((sum, s) => sum + s.new_errors.length, 0);
  const totalResolvedErrors = stepDiffs.reduce((sum, s) => sum + s.resolved_errors.length, 0);

  return {
    run_a: runIdA,
    run_b: runIdB,
    steps: stepDiffs,
    http_diff: httpDiff,
    summary: {
      steps_changed: stepsChanged,
      http_calls_delta: (summaryB?.total_http_calls ?? 0) - (summaryA?.total_http_calls ?? 0),
      fs_ops_delta: (summaryB?.total_fs_operations ?? 0) - (summaryA?.total_fs_operations ?? 0),
      new_errors: totalNewErrors,
      resolved_errors: totalResolvedErrors,
    },
  };
}
