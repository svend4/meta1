/**
 * Step Dependency Injection — steps declare inputs/outputs and the
 * runtime automatically wires data flow between them.
 *
 * Steps can declare:
 *   inputs:  [{ name: 'config_path', from: 'create-config.outputs.file_path' }]
 *   outputs: [{ name: 'file_path', value: 'config.json' }]
 *
 * At runtime, input values are resolved from previously completed step outputs.
 */

import type { Step } from '../types/execution-plan.js';

/** A declared output from a step */
export interface StepOutput {
  /** Output name (e.g., 'file_path', 'exit_code', 'stdout') */
  name: string;
  /** Static value, or resolved at runtime from step result */
  value?: string;
}

/** A declared input for a step */
export interface StepInput {
  /** Input name */
  name: string;
  /** Reference to another step's output: 'step_id.outputs.output_name' */
  from: string;
  /** Default value if the referenced output is unavailable */
  default?: string;
}

/** Step with declared I/O */
export type StepWithIO = Step & {
  inputs?: StepInput[];
  outputs?: StepOutput[];
};

/** Resolved output values collected during execution */
export type OutputRegistry = Map<string, Map<string, string>>;

/**
 * Build an output registry from a set of step results.
 */
export function buildOutputRegistry(
  steps: StepWithIO[],
  results: Map<string, Record<string, string>>,
): OutputRegistry {
  const registry: OutputRegistry = new Map();

  for (const step of steps) {
    const stepOutputs = new Map<string, string>();

    // Static outputs from step declaration
    if (step.outputs) {
      for (const out of step.outputs) {
        if (out.value !== undefined) {
          stepOutputs.set(out.name, out.value);
        }
      }
    }

    // Runtime outputs from execution results
    const runtimeOutputs = results.get(step.step_id);
    if (runtimeOutputs) {
      for (const [key, val] of Object.entries(runtimeOutputs)) {
        stepOutputs.set(key, val);
      }
    }

    registry.set(step.step_id, stepOutputs);
  }

  return registry;
}

/**
 * Resolve input values for a step from the output registry.
 */
export function resolveInputs(
  step: StepWithIO,
  registry: OutputRegistry,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  if (!step.inputs) return resolved;

  for (const input of step.inputs) {
    const ref = parseOutputRef(input.from);
    if (!ref) {
      if (input.default !== undefined) {
        resolved[input.name] = input.default;
      } else {
        throw new Error(
          `Step "${step.step_id}": invalid input reference "${input.from}" — expected format "step_id.outputs.output_name"`,
        );
      }
      continue;
    }

    const stepOutputs = registry.get(ref.stepId);
    const value = stepOutputs?.get(ref.outputName);

    if (value !== undefined) {
      resolved[input.name] = value;
    } else if (input.default !== undefined) {
      resolved[input.name] = input.default;
    } else {
      throw new Error(
        `Step "${step.step_id}": required input "${input.name}" — output "${ref.outputName}" not found on step "${ref.stepId}"`,
      );
    }
  }

  return resolved;
}

/**
 * Validate that all input references in a plan can be resolved.
 * Returns a list of issues found (empty = valid).
 */
export function validateStepIO(steps: StepWithIO[]): string[] {
  const issues: string[] = [];
  const ids = new Set(steps.map((s) => s.step_id));
  const declaredOutputs = new Map<string, Set<string>>();

  for (const step of steps) {
    const names = new Set<string>();
    if (step.outputs) {
      for (const out of step.outputs) {
        names.add(out.name);
      }
    }
    declaredOutputs.set(step.step_id, names);
  }

  for (const step of steps) {
    if (!step.inputs) continue;

    for (const input of step.inputs) {
      const ref = parseOutputRef(input.from);
      if (!ref) {
        issues.push(`Step "${step.step_id}": input "${input.name}" has invalid reference "${input.from}"`);
        continue;
      }

      if (!ids.has(ref.stepId)) {
        issues.push(`Step "${step.step_id}": input "${input.name}" references unknown step "${ref.stepId}"`);
        continue;
      }

      const outputs = declaredOutputs.get(ref.stepId);
      if (outputs && !outputs.has(ref.outputName)) {
        // Only warn — runtime outputs may not be declared statically
        if (input.default === undefined) {
          issues.push(`Step "${step.step_id}": input "${input.name}" references undeclared output "${ref.outputName}" on step "${ref.stepId}" (no default)`);
        }
      }

      // Verify ordering: source step must come before this step
      const deps = step.depends_on ?? [];
      if (!deps.includes(ref.stepId) && !isTransitiveDep(ref.stepId, step.step_id, steps)) {
        issues.push(`Step "${step.step_id}": input from "${ref.stepId}" but no dependency declared — add "${ref.stepId}" to depends_on`);
      }
    }
  }

  return issues;
}

/**
 * Infer depends_on from input references (auto-wiring).
 * Returns new steps with additional deps added.
 */
export function inferDependencies(steps: StepWithIO[]): StepWithIO[] {
  return steps.map((step) => {
    if (!step.inputs || step.inputs.length === 0) return step;

    const existing = new Set(step.depends_on ?? []);
    let added = false;

    for (const input of step.inputs) {
      const ref = parseOutputRef(input.from);
      if (ref && !existing.has(ref.stepId)) {
        existing.add(ref.stepId);
        added = true;
      }
    }

    if (!added) return step;

    return { ...step, depends_on: [...existing] };
  });
}

/**
 * List all I/O declarations in a plan.
 */
export function listStepIO(steps: StepWithIO[]): Array<{
  stepId: string;
  inputs: StepInput[];
  outputs: StepOutput[];
}> {
  return steps
    .filter((s) => (s.inputs && s.inputs.length > 0) || (s.outputs && s.outputs.length > 0))
    .map((s) => ({
      stepId: s.step_id,
      inputs: s.inputs ?? [],
      outputs: s.outputs ?? [],
    }));
}

// ── Internal ──

interface OutputRef {
  stepId: string;
  outputName: string;
}

function parseOutputRef(ref: string): OutputRef | null {
  const parts = ref.split('.');
  if (parts.length === 3 && parts[1] === 'outputs') {
    return { stepId: parts[0], outputName: parts[2] };
  }
  return null;
}

function isTransitiveDep(target: string, from: string, steps: StepWithIO[]): boolean {
  const visited = new Set<string>();
  const stepMap = new Map(steps.map((s) => [s.step_id, s]));

  function walk(stepId: string): boolean {
    if (stepId === target) return true;
    if (visited.has(stepId)) return false;
    visited.add(stepId);

    const step = stepMap.get(stepId);
    for (const dep of step?.depends_on ?? []) {
      if (walk(dep)) return true;
    }
    return false;
  }

  return walk(from);
}
