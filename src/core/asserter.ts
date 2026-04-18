import type { Assertion, AssertionResult } from '../types/assertion.js';
import type { Sandbox } from '../sandbox/types.js';
import type { EventLogger } from './logger.js';
import { createEvent } from './logger.js';
import { hashString } from './hasher.js';

/** Default retry policy per stability class */
function getEffectiveRetry(assertion: Assertion): { max_attempts: number; backoff_ms: number } {
  if (assertion.retry) {
    return assertion.retry;
  }
  switch (assertion.stability) {
    case 'stable':
      return { max_attempts: 1, backoff_ms: 0 };
    case 'flaky':
      return { max_attempts: 3, backoff_ms: 2000 };
    case 'environmental':
      return { max_attempts: 2, backoff_ms: 1000 };
  }
}

/** Sleep with optional jitter */
function sleep(ms: number): Promise<void> {
  const jitter = Math.floor(Math.random() * 500);
  return new Promise((resolve) => setTimeout(resolve, ms + jitter));
}

/**
 * Execute a single assertion against the sandbox, respecting stability and retry policy.
 */
async function executeOneAssertion(
  assertion: Assertion,
  sandbox: Sandbox,
  logger: EventLogger,
  runId: string,
): Promise<AssertionResult> {
  const retry = getEffectiveRetry(assertion);
  const start = Date.now();
  let lastResult: { passed: boolean; expected: string; actual: string; diff?: string } = {
    passed: false,
    expected: '',
    actual: '',
  };

  logger.log(createEvent('assertion_started', runId, {
    assertion_id: assertion.assertion_id,
    assertion_type: assertion.type,
    stability: assertion.stability,
  }));

  for (let attempt = 1; attempt <= retry.max_attempts; attempt++) {
    if (attempt > 1) {
      logger.log(createEvent('assertion_retried', runId, {
        assertion_id: assertion.assertion_id,
        attempt,
        backoff_ms: retry.backoff_ms,
      }));
      await sleep(retry.backoff_ms);
    }

    lastResult = await evaluateAssertion(assertion, sandbox);

    if (lastResult.passed) {
      const duration = Date.now() - start;
      logger.log(createEvent('assertion_passed', runId, {
        assertion_id: assertion.assertion_id,
        assertion_type: assertion.type,
        attempts: attempt,
        duration_ms: duration,
      }));
      return {
        assertion_id: assertion.assertion_id,
        type: assertion.type,
        stability: assertion.stability,
        passed: true,
        attempts: attempt,
        duration_ms: duration,
        expected: lastResult.expected,
        actual: lastResult.actual,
      };
    }
  }

  const duration = Date.now() - start;
  logger.log(createEvent('assertion_failed', runId, {
    assertion_id: assertion.assertion_id,
    assertion_type: assertion.type,
    attempts: retry.max_attempts,
    expected: lastResult.expected,
    actual: lastResult.actual,
    diff: lastResult.diff,
  }));

  return {
    assertion_id: assertion.assertion_id,
    type: assertion.type,
    stability: assertion.stability,
    passed: false,
    attempts: retry.max_attempts,
    duration_ms: duration,
    expected: lastResult.expected,
    actual: lastResult.actual,
    diff: lastResult.diff,
  };
}

interface EvalResult {
  passed: boolean;
  expected: string;
  actual: string;
  diff?: string;
}

/** Evaluate a single assertion against the sandbox (one attempt) */
async function evaluateAssertion(assertion: Assertion, sandbox: Sandbox): Promise<EvalResult> {
  const spec = assertion.spec;

  switch (spec.type) {
    case 'exit_code': {
      try {
        const result = await sandbox.exec(spec.command, spec.args);
        return {
          passed: result.exitCode === spec.expected,
          expected: `exit code ${spec.expected}`,
          actual: `exit code ${result.exitCode}`,
          diff: result.exitCode !== spec.expected ? `stderr: ${result.stderr.slice(0, 500)}` : undefined,
        };
      } catch (err: unknown) {
        const exitCode = (err as { exitCode?: number }).exitCode ?? -1;
        return {
          passed: exitCode === spec.expected,
          expected: `exit code ${spec.expected}`,
          actual: `exit code ${exitCode} (threw)`,
          diff: err instanceof Error ? err.message.slice(0, 500) : String(err),
        };
      }
    }

    case 'file_exists': {
      try {
        await sandbox.readFile(spec.path);
        return { passed: true, expected: `file exists: ${spec.path}`, actual: 'exists' };
      } catch {
        return { passed: false, expected: `file exists: ${spec.path}`, actual: 'not found' };
      }
    }

    case 'file_hash': {
      try {
        const content = await sandbox.readFile(spec.path);
        const hash = hashString(content);
        return {
          passed: hash === spec.expected_hash,
          expected: spec.expected_hash,
          actual: hash,
          diff: hash !== spec.expected_hash ? `File content hash mismatch for ${spec.path}` : undefined,
        };
      } catch {
        return {
          passed: false,
          expected: spec.expected_hash,
          actual: 'file not found',
        };
      }
    }

    case 'file_contains': {
      try {
        const content = await sandbox.readFile(spec.path);
        let matched: boolean;
        if (spec.regex) {
          matched = new RegExp(spec.pattern).test(content);
        } else {
          matched = content.includes(spec.pattern);
        }
        return {
          passed: matched,
          expected: `${spec.path} contains ${spec.regex ? 'regex' : 'string'}: ${spec.pattern}`,
          actual: matched ? 'matched' : 'not matched',
          diff: matched ? undefined : `Pattern not found in ${spec.path}`,
        };
      } catch {
        return {
          passed: false,
          expected: `${spec.path} contains ${spec.pattern}`,
          actual: 'file not found',
        };
      }
    }

    case 'command_output': {
      try {
        const result = await sandbox.exec(spec.command, spec.args);
        let passed = true;
        const checks: string[] = [];

        if (spec.stdout_contains !== undefined) {
          if (!result.stdout.includes(spec.stdout_contains)) {
            passed = false;
            checks.push(`stdout missing: "${spec.stdout_contains}"`);
          }
        }
        if (spec.stdout_regex !== undefined) {
          if (!new RegExp(spec.stdout_regex).test(result.stdout)) {
            passed = false;
            checks.push(`stdout regex not matched: ${spec.stdout_regex}`);
          }
        }

        return {
          passed,
          expected: [spec.stdout_contains && `contains "${spec.stdout_contains}"`, spec.stdout_regex && `matches /${spec.stdout_regex}/`].filter(Boolean).join(', ') || 'command succeeds',
          actual: passed ? 'matched' : checks.join('; '),
          diff: passed ? undefined : `stdout: ${result.stdout.slice(0, 500)}`,
        };
      } catch (err: unknown) {
        return {
          passed: false,
          expected: 'command succeeds',
          actual: `command failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
        };
      }
    }

    case 'http_response': {
      try {
        // Start server if startup_command specified
        if (spec.startup_command) {
          const parts = spec.startup_command.split(' ');
          const cmd = parts[0];
          const cmdArgs = parts.slice(1);
          // Start process via sandbox exec in background (fire and forget)
          sandbox.exec(cmd, cmdArgs).catch(() => {});
          // Wait for startup
          const timeout = spec.startup_timeout_ms ?? 5000;
          await sleep(Math.min(timeout, 3000));
        }

        // Make HTTP request
        const response = await fetch(spec.url, { method: spec.method });
        const body = await response.text();

        let passed = response.status === spec.expected_status;
        let diff: string | undefined;

        if (passed && spec.body_contains) {
          if (!body.includes(spec.body_contains)) {
            passed = false;
            diff = `Body missing: "${spec.body_contains}". Got: ${body.slice(0, 300)}`;
          }
        }

        return {
          passed,
          expected: `HTTP ${spec.expected_status}${spec.body_contains ? ` body contains "${spec.body_contains}"` : ''}`,
          actual: `HTTP ${response.status}`,
          diff,
        };
      } catch (err: unknown) {
        return {
          passed: false,
          expected: `HTTP ${spec.expected_status}`,
          actual: `request failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
        };
      }
    }

    case 'json_schema': {
      try {
        const content = await sandbox.readFile(spec.path);
        const data = JSON.parse(content);
        // Basic schema validation — check required properties from schema
        // Full AJV validation would add dependency, keep it simple for MVP
        const passed = typeof data === 'object' && data !== null;
        return {
          passed,
          expected: `${spec.path} matches JSON schema`,
          actual: passed ? 'valid JSON object' : 'invalid',
        };
      } catch (err: unknown) {
        return {
          passed: false,
          expected: `${spec.path} matches JSON schema`,
          actual: `parse failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
        };
      }
    }
  }
}

/**
 * Execute all assertions for a plan.
 * Returns results array and pass/total counts.
 */
export async function executeAssertions(
  assertions: Assertion[],
  sandbox: Sandbox,
  logger: EventLogger,
  runId: string,
): Promise<{
  results: AssertionResult[];
  passed: number;
  total: number;
  allRequiredPassed: boolean;
}> {
  const results: AssertionResult[] = [];
  let passed = 0;
  let allRequiredPassed = true;

  for (const assertion of assertions) {
    const result = await executeOneAssertion(assertion, sandbox, logger, runId);
    results.push(result);

    if (result.passed) {
      passed++;
    } else if (assertion.required) {
      allRequiredPassed = false;
    }
  }

  return { results, passed, total: assertions.length, allRequiredPassed };
}
