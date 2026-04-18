import type { Assertion, AssertionResult } from '../types/assertion.js';
import type { DriftVector } from '../types/drift-vector.js';
import type { Sandbox } from '../sandbox/types.js';
import type { EventLogger } from './logger.js';
import { executeAssertions } from './asserter.js';

/**
 * Level 1: Retry — for flaky/environmental assertion failures.
 * Re-executes ONLY the assertions (not steps), with their retry policies.
 * Returns updated assertion results.
 */
export async function retryFlakyAssertions(
  assertions: Assertion[],
  failedResults: AssertionResult[],
  driftVectors: DriftVector[],
  sandbox: Sandbox,
  logger: EventLogger,
  runId: string,
): Promise<{
  resolved: DriftVector[];
  remaining: DriftVector[];
  updatedResults: AssertionResult[];
}> {
  // Only retry assertions that are flaky or environmental
  const retryableDrifts = driftVectors.filter(
    (d) => d.category === 'assertion_flaky' || d.category === 'assertion_environmental',
  );

  if (retryableDrifts.length === 0) {
    return { resolved: [], remaining: driftVectors, updatedResults: failedResults };
  }

  // Get the assertion IDs that need retrying
  const retryableIds = new Set(
    retryableDrifts
      .map((d) => d.details.assertion_id)
      .filter((id): id is string => id !== undefined),
  );

  // Filter to assertions that need retrying
  const assertionsToRetry = assertions.filter(
    (a) => retryableIds.has(a.assertion_id) && (a.stability === 'flaky' || a.stability === 'environmental'),
  );

  if (assertionsToRetry.length === 0) {
    return { resolved: [], remaining: driftVectors, updatedResults: failedResults };
  }

  // Re-execute the retryable assertions
  const retryResult = await executeAssertions(assertionsToRetry, sandbox, logger, runId);

  // Merge results
  const updatedResults = failedResults.map((r) => {
    const retried = retryResult.results.find((rr) => rr.assertion_id === r.assertion_id);
    return retried ?? r;
  });

  // Determine which drifts were resolved
  const nowPassedIds = new Set(
    retryResult.results.filter((r) => r.passed).map((r) => r.assertion_id),
  );

  const resolved = retryableDrifts.filter(
    (d) => d.details.assertion_id && nowPassedIds.has(d.details.assertion_id),
  );

  const resolvedIds = new Set(resolved.map((d) => d.drift_id));
  const remaining = driftVectors.filter((d) => !resolvedIds.has(d.drift_id));

  return { resolved, remaining, updatedResults };
}
