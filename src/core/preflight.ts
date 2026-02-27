import { existsSync, accessSync, constants, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { ExecutionPlan } from '../types/execution-plan.js';
import { isPlanV3 } from '../types/execution-plan.js';
import type { ExecutionPlanV3 } from '../types/execution-plan.js';
import { validateExecutionPlan } from './validator.js';
import { buildDependencyGraph } from './executor.js';
import { validateIOSignature } from './io-signature.js';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface CheckResult {
  check: string;
  status: CheckStatus;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  checks: CheckResult[];
  timestamp: string;
}

export function checkPlanStructure(plan: unknown): CheckResult {
  const result = validateExecutionPlan(plan);
  return {
    check: 'plan_structure',
    status: result.valid ? 'pass' : 'fail',
    message: result.valid ? 'Plan schema is valid' : `Invalid: ${result.errors.join('; ')}`,
  };
}

export function checkDependencies(plan: ExecutionPlan): CheckResult {
  try {
    buildDependencyGraph(plan.steps);
    return { check: 'dependencies', status: 'pass', message: 'Step dependencies are valid (no cycles)' };
  } catch (err: unknown) {
    return { check: 'dependencies', status: 'fail', message: err instanceof Error ? err.message : String(err) };
  }
}

export function checkAssertionTargets(plan: ExecutionPlan): CheckResult {
  if (!isPlanV3(plan)) {
    return { check: 'assertions', status: 'skip', message: 'Not a v3.0 plan' };
  }

  const v3 = plan as ExecutionPlanV3;
  if (!v3.assertions || v3.assertions.length === 0) {
    return { check: 'assertions', status: 'skip', message: 'No assertions defined' };
  }

  const stepIds = new Set(plan.steps.map((s) => s.step_id));
  const errors: string[] = [];

  for (const assertion of v3.assertions) {
    const spec = assertion.spec;
    if ('step_id' in spec && typeof spec.step_id === 'string') {
      if (!stepIds.has(spec.step_id)) {
        errors.push(`Assertion "${assertion.assertion_id}" references unknown step "${spec.step_id}"`);
      }
    }
  }

  if (errors.length > 0) {
    return { check: 'assertions', status: 'fail', message: errors.join('; ') };
  }

  return { check: 'assertions', status: 'pass', message: `${v3.assertions.length} assertion(s) valid` };
}

export function checkApiKey(envVarName: string): CheckResult {
  const value = process.env[envVarName];
  return {
    check: 'api_key',
    status: value ? 'pass' : 'warn',
    message: value ? `API key found in ${envVarName}` : `No API key in ${envVarName} (LLM calls will fail)`,
  };
}

export function checkDockerDaemon(): CheckResult {
  try {
    execFileSync('docker', ['info'], { timeout: 5000, stdio: 'pipe' });
    return { check: 'docker', status: 'pass', message: 'Docker daemon is running' };
  } catch {
    return { check: 'docker', status: 'fail', message: 'Docker daemon not available' };
  }
}

export function checkWorkspace(dir: string): CheckResult {
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
      return { check: 'workspace', status: 'pass', message: `Workspace created: ${dir}` };
    } catch {
      return { check: 'workspace', status: 'fail', message: `Cannot create workspace: ${dir}` };
    }
  }

  try {
    accessSync(dir, constants.W_OK);
    return { check: 'workspace', status: 'pass', message: `Workspace writable: ${dir}` };
  } catch {
    return { check: 'workspace', status: 'fail', message: `Workspace not writable: ${dir}` };
  }
}

export function checkIOSignature(plan: ExecutionPlan): CheckResult {
  if (!isPlanV3(plan)) {
    return { check: 'io_signature', status: 'skip', message: 'Not a v3.0 plan' };
  }

  const v3 = plan as ExecutionPlanV3;
  if (!v3.plan_signature) {
    return { check: 'io_signature', status: 'skip', message: 'No IO signature defined' };
  }

  const issues = validateIOSignature(v3);
  if (issues.length === 0) {
    return { check: 'io_signature', status: 'pass', message: 'IO signature matches plan steps' };
  }

  return { check: 'io_signature', status: 'warn', message: `IO signature issues: ${issues.join('; ')}` };
}

/**
 * Run all pre-flight checks and produce a validation report.
 */
export function runPreflight(options: {
  plan?: unknown;
  apiKeyEnv?: string;
  sandboxType?: 'local' | 'docker';
  workspace?: string;
}): ValidationReport {
  const checks: CheckResult[] = [];

  if (options.plan) {
    checks.push(checkPlanStructure(options.plan));

    if (checks[checks.length - 1].status === 'pass') {
      const plan = options.plan as ExecutionPlan;
      checks.push(checkDependencies(plan));
      checks.push(checkAssertionTargets(plan));
      checks.push(checkIOSignature(plan));
    }
  }

  if (options.apiKeyEnv) {
    checks.push(checkApiKey(options.apiKeyEnv));
  }

  if (options.sandboxType === 'docker') {
    checks.push(checkDockerDaemon());
  }

  if (options.workspace) {
    checks.push(checkWorkspace(options.workspace));
  }

  return {
    valid: checks.every((c) => c.status !== 'fail'),
    checks,
    timestamp: new Date().toISOString(),
  };
}
