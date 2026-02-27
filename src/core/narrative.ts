import type { RunSummary } from '../types/run-summary.js';

/**
 * Generate a natural-language narrative of a run execution.
 * Template-based (zero LLM cost) — produces readable prose from run data.
 */
export function generateNarrative(summary: RunSummary): string {
  const sections: string[] = [];

  // Opening
  sections.push(generateOpening(summary));

  // Step-by-step narrative
  sections.push(generateStepNarrative(summary));

  // Assertions
  if (summary.assertion_results && summary.assertion_results.length > 0) {
    sections.push(generateAssertionNarrative(summary));
  }

  // Token usage
  if (summary.token_usage) {
    sections.push(generateCostNarrative(summary));
  }

  // Conclusion
  sections.push(generateConclusion(summary));

  return sections.join('\n\n');
}

function generateOpening(s: RunSummary): string {
  const time = formatTime(s.started_at);
  const source = s.plan_source === 'llm' ? 'AI-generated' : s.plan_source === 'cache' ? 'cached' : s.plan_source;
  const dur = s.duration_ms ? ` and completed in ${formatDuration(s.duration_ms)}` : '';

  return `The execution "${s.prompt}" began at ${time} using a ${source} plan with ${s.plan.steps.length} steps${dur}.`;
}

function generateStepNarrative(s: RunSummary): string {
  const lines: string[] = [];
  const total = s.steps.length;
  const completed = s.steps.filter((st) => st.status === 'completed');
  const failed = s.steps.filter((st) => st.status === 'failed');
  const skipped = s.steps.filter((st) => st.status === 'skipped');

  if (total === completed.length) {
    lines.push(`All ${total} steps executed successfully.`);
  } else {
    lines.push(`Of the ${total} steps, ${completed.length} completed successfully${failed.length ? `, ${failed.length} failed` : ''}${skipped.length ? `, and ${skipped.length} were skipped` : ''}.`);
  }

  // Narrate key steps
  for (let i = 0; i < s.steps.length; i++) {
    const step = s.steps[i];
    const ordinal = ordinalWord(i + 1);
    const desc = step.description ?? step.step_id;

    if (step.status === 'completed') {
      const dur = step.duration_ms ? ` (${formatDuration(step.duration_ms)})` : '';
      if (step.type === 'create_file') {
        lines.push(`${ordinal}, a file was created: ${desc}${dur}.`);
      } else {
        lines.push(`${ordinal}, a command was executed: ${desc}${dur}.`);
      }
    } else if (step.status === 'failed') {
      const reason = step.error ? ` The error was: "${step.error}"` : '';
      lines.push(`${ordinal}, ${desc} failed.${reason}`);
    } else if (step.status === 'skipped') {
      lines.push(`${ordinal}, ${desc} was skipped.`);
    }
  }

  return lines.join(' ');
}

function generateAssertionNarrative(s: RunSummary): string {
  const results = s.assertion_results!;
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  if (passed === total) {
    return `All ${total} assertions passed, confirming the execution produced the expected results.`;
  }

  const lines: string[] = [];
  lines.push(`${passed} of ${total} assertions passed.`);

  for (const r of results.filter((r) => !r.passed)) {
    const retried = r.attempts > 1 ? ` after ${r.attempts} attempts` : '';
    lines.push(`The "${r.assertion_id}" assertion (${r.type}) failed${retried}: expected ${r.expected} but got ${r.actual}.`);
  }

  return lines.join(' ');
}

function generateCostNarrative(s: RunSummary): string {
  const t = s.token_usage!;
  const parts: string[] = [];

  if (t.input_tokens || t.output_tokens) {
    parts.push(`The plan generation consumed ${(t.input_tokens ?? 0).toLocaleString()} input tokens and ${(t.output_tokens ?? 0).toLocaleString()} output tokens`);
  }

  if (t.estimated_cost_usd) {
    parts.push(`at an estimated cost of $${t.estimated_cost_usd.toFixed(4)}`);
  }

  return parts.join(' ') + '.';
}

function generateConclusion(s: RunSummary): string {
  switch (s.status) {
    case 'completed':
      return 'The execution completed successfully with all steps passing.';
    case 'verified':
      return 'The execution was verified — all steps completed and all assertions passed.';
    case 'failed': {
      const failedStep = s.steps.find((st) => st.status === 'failed');
      if (failedStep) {
        return `The execution failed at step "${failedStep.step_id}"${failedStep.error ? `: ${failedStep.error}` : ''}.`;
      }
      return 'The execution failed.';
    }
    case 'assertion_failed':
      return 'The execution completed but one or more assertions failed, indicating the output did not match expectations.';
    case 'benign_drift':
      return 'The execution completed with benign drift detected — the outputs differed from the expected baseline but were deemed acceptable.';
    case 'healed':
      return 'The execution initially failed but was automatically repaired and completed successfully.';
    default:
      return `The execution ended with status: ${s.status}.`;
  }
}

// ── Helpers ──

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

function ordinalWord(n: number): string {
  if (n <= 10) {
    const words = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
    return words[n];
  }
  return `Step ${n}`;
}
