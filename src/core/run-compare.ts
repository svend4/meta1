import type { RunSummary } from '../types/run-summary.js';

/** Comparison between two runs */
export interface RunComparison {
  runA: RunBrief;
  runB: RunBrief;
  statusMatch: boolean;
  durationDeltaMs?: number;
  stepComparisons: StepComparison[];
  tokenDelta?: TokenDelta;
  summary: string;
}

/** Brief run info for comparison display */
export interface RunBrief {
  run_id: string;
  status: string;
  started_at: string;
  duration_ms?: number;
  plan_source: string;
  steps_total: number;
}

/** Comparison of a single step across two runs */
export interface StepComparison {
  step_id: string;
  /** Which runs contain this step */
  presence: 'both' | 'only_a' | 'only_b';
  statusA?: string;
  statusB?: string;
  statusMatch: boolean;
  hashMatch?: boolean;
  durationDeltaMs?: number;
  outputDiff?: boolean;
}

/** Token usage delta between two runs */
export interface TokenDelta {
  inputDelta: number;
  outputDelta: number;
  costDelta: number;
}

/**
 * Compare two runs side-by-side.
 */
export function compareRuns(a: RunSummary, b: RunSummary): RunComparison {
  const runA: RunBrief = {
    run_id: a.run_id,
    status: a.status,
    started_at: a.started_at,
    duration_ms: a.duration_ms,
    plan_source: a.plan_source,
    steps_total: a.steps.length,
  };

  const runB: RunBrief = {
    run_id: b.run_id,
    status: b.status,
    started_at: b.started_at,
    duration_ms: b.duration_ms,
    plan_source: b.plan_source,
    steps_total: b.steps.length,
  };

  // Step comparison
  const stepsA = new Map(a.steps.map((s) => [s.step_id, s]));
  const stepsB = new Map(b.steps.map((s) => [s.step_id, s]));
  const allStepIds = new Set([...stepsA.keys(), ...stepsB.keys()]);

  const stepComparisons: StepComparison[] = [];
  for (const stepId of allStepIds) {
    const sa = stepsA.get(stepId);
    const sb = stepsB.get(stepId);

    if (sa && sb) {
      stepComparisons.push({
        step_id: stepId,
        presence: 'both',
        statusA: sa.status,
        statusB: sb.status,
        statusMatch: sa.status === sb.status,
        hashMatch: sa.artifact_hash === sb.artifact_hash,
        durationDeltaMs: (sb.duration_ms ?? 0) - (sa.duration_ms ?? 0),
        outputDiff: sa.stdout !== sb.stdout || sa.stderr !== sb.stderr,
      });
    } else if (sa) {
      stepComparisons.push({
        step_id: stepId,
        presence: 'only_a',
        statusA: sa.status,
        statusMatch: false,
      });
    } else {
      stepComparisons.push({
        step_id: stepId,
        presence: 'only_b',
        statusB: sb!.status,
        statusMatch: false,
      });
    }
  }

  // Token delta
  let tokenDelta: TokenDelta | undefined;
  if (a.token_usage && b.token_usage) {
    tokenDelta = {
      inputDelta: b.token_usage.input_tokens - a.token_usage.input_tokens,
      outputDelta: b.token_usage.output_tokens - a.token_usage.output_tokens,
      costDelta: (b.token_usage.estimated_cost_usd ?? 0) - (a.token_usage.estimated_cost_usd ?? 0),
    };
  }

  const durationDeltaMs = a.duration_ms !== undefined && b.duration_ms !== undefined
    ? b.duration_ms - a.duration_ms : undefined;

  const matchingSteps = stepComparisons.filter((s) => s.statusMatch).length;
  const hashMatches = stepComparisons.filter((s) => s.hashMatch).length;
  const summary = `${a.status === b.status ? 'Same' : 'Different'} status, ` +
    `${matchingSteps}/${stepComparisons.length} steps match, ` +
    `${hashMatches}/${stepComparisons.filter((s) => s.presence === 'both').length} hashes match`;

  return {
    runA,
    runB,
    statusMatch: a.status === b.status,
    durationDeltaMs,
    stepComparisons,
    tokenDelta,
    summary,
  };
}

/**
 * Format a run comparison as a human-readable string.
 */
export function formatComparison(cmp: RunComparison): string {
  const lines: string[] = [];

  lines.push('Run Comparison');
  lines.push('');
  lines.push(`  Run A: ${cmp.runA.run_id.slice(0, 8)}  [${cmp.runA.status}]  ${cmp.runA.duration_ms ?? '?'}ms  source=${cmp.runA.plan_source}`);
  lines.push(`  Run B: ${cmp.runB.run_id.slice(0, 8)}  [${cmp.runB.status}]  ${cmp.runB.duration_ms ?? '?'}ms  source=${cmp.runB.plan_source}`);

  if (cmp.durationDeltaMs !== undefined) {
    const sign = cmp.durationDeltaMs >= 0 ? '+' : '';
    lines.push(`  Duration delta: ${sign}${cmp.durationDeltaMs}ms`);
  }

  lines.push('');
  lines.push('  Steps:');

  for (const sc of cmp.stepComparisons) {
    if (sc.presence === 'both') {
      const statusIcon = sc.statusMatch ? '=' : '!';
      const hashIcon = sc.hashMatch ? '=' : '!';
      lines.push(`    ${statusIcon} ${sc.step_id}: ${sc.statusA} → ${sc.statusB} (hash ${hashIcon})`);
    } else if (sc.presence === 'only_a') {
      lines.push(`    - ${sc.step_id}: only in A [${sc.statusA}]`);
    } else {
      lines.push(`    + ${sc.step_id}: only in B [${sc.statusB}]`);
    }
  }

  if (cmp.tokenDelta) {
    lines.push('');
    const sign = (n: number) => n >= 0 ? `+${n}` : `${n}`;
    lines.push(`  Token delta: ${sign(cmp.tokenDelta.inputDelta)} in / ${sign(cmp.tokenDelta.outputDelta)} out`);
    lines.push(`  Cost delta: ${sign(Math.round(cmp.tokenDelta.costDelta * 1_000_000) / 1_000_000)} USD`);
  }

  lines.push('');
  lines.push(`  ${cmp.summary}`);

  return lines.join('\n');
}
