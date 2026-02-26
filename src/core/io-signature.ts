import type { ExecutionPlan } from '../types/execution-plan.js';
import type { PlanIOSignature } from '../types/plan-io-signature.js';

/**
 * Infer the I/O signature of a plan by analyzing its steps.
 * - Inputs: files read by commands (heuristic: depends_on step outputs)
 * - Exports: files created by create_file steps
 */
export function inferIOSignature(plan: ExecutionPlan): PlanIOSignature {
  const inputFiles = new Set<string>();
  const exportArtifacts = new Set<string>();
  const envVarsUsed = new Set<string>();

  for (const step of plan.steps) {
    if (step.type === 'create_file') {
      exportArtifacts.add(step.path);
    } else if (step.type === 'run_command') {
      // Scan command + args for env var references ($VAR or ${VAR})
      const fullCmd = `${step.command} ${step.args.join(' ')}`;
      const envMatches = fullCmd.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g);
      for (const match of envMatches) {
        envVarsUsed.add(match[1]);
      }

      // If this step depends on create_file steps, those files are inputs to this step
      if (step.depends_on) {
        for (const depId of step.depends_on) {
          const depStep = plan.steps.find((s) => s.step_id === depId);
          if (depStep?.type === 'create_file') {
            inputFiles.add(depStep.path);
          }
        }
      }
    }
  }

  return {
    inputs: {
      files: inputFiles.size > 0 ? [...inputFiles].sort() : undefined,
      env_vars: envVarsUsed.size > 0 ? [...envVarsUsed].sort() : undefined,
    },
    exports: {
      artifacts: [...exportArtifacts].sort(),
      env_vars: undefined,
    },
  };
}

/**
 * Validate that a plan's declared IO signature matches what the steps actually do.
 * Returns a list of discrepancies (empty = valid).
 */
export function validateIOSignature(
  plan: ExecutionPlan & { plan_signature?: PlanIOSignature },
): string[] {
  if (!plan.plan_signature) return [];

  const inferred = inferIOSignature(plan);
  const issues: string[] = [];

  // Check declared exports vs actual
  const declaredExports = new Set(plan.plan_signature.exports?.artifacts ?? []);
  const actualExports = new Set(inferred.exports?.artifacts ?? []);

  for (const exp of declaredExports) {
    if (!actualExports.has(exp)) {
      issues.push(`Declared export "${exp}" not produced by any step`);
    }
  }

  for (const exp of actualExports) {
    if (!declaredExports.has(exp)) {
      issues.push(`Step produces "${exp}" but it is not declared in exports`);
    }
  }

  // Check declared inputs
  const declaredInputs = new Set(plan.plan_signature.inputs?.files ?? []);
  const actualInputs = new Set(inferred.inputs?.files ?? []);

  for (const inp of declaredInputs) {
    if (!actualInputs.has(inp)) {
      issues.push(`Declared input "${inp}" not referenced in step dependencies`);
    }
  }

  return issues;
}
