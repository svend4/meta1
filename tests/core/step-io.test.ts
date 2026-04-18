import { describe, it, expect } from 'vitest';
import {
  buildOutputRegistry,
  resolveInputs,
  validateStepIO,
  inferDependencies,
  listStepIO,
} from '../../src/core/step-io.js';
import type { StepWithIO } from '../../src/core/step-io.js';
import type { Step } from '../../src/types/execution-plan.js';

function makeSteps(): StepWithIO[] {
  return [
    {
      step_id: 'create-config',
      type: 'create_file',
      description: 'Create config',
      path: 'config.json',
      content: '{}',
      determinism: 'guaranteed',
      outputs: [{ name: 'file_path', value: 'config.json' }],
    } as StepWithIO,
    {
      step_id: 'run-build',
      type: 'run_command',
      description: 'Build',
      command: 'npm',
      args: ['build'],
      determinism: 'best_effort',
      depends_on: ['create-config'],
      inputs: [{ name: 'config', from: 'create-config.outputs.file_path' }],
      outputs: [{ name: 'exit_code' }],
    } as StepWithIO,
  ];
}

describe('buildOutputRegistry', () => {
  it('builds from static outputs', () => {
    const steps = makeSteps();
    const results = new Map<string, Record<string, string>>();
    const registry = buildOutputRegistry(steps, results);

    expect(registry.get('create-config')?.get('file_path')).toBe('config.json');
  });

  it('merges runtime outputs', () => {
    const steps = makeSteps();
    const results = new Map([['run-build', { exit_code: '0', stdout: 'ok' }]]);
    const registry = buildOutputRegistry(steps, results);

    expect(registry.get('run-build')?.get('exit_code')).toBe('0');
    expect(registry.get('run-build')?.get('stdout')).toBe('ok');
  });
});

describe('resolveInputs', () => {
  it('resolves input from output registry', () => {
    const steps = makeSteps();
    const registry = buildOutputRegistry(steps, new Map());
    const resolved = resolveInputs(steps[1], registry);

    expect(resolved.config).toBe('config.json');
  });

  it('uses default value when output missing', () => {
    const step: StepWithIO = {
      step_id: 's1',
      type: 'run_command',
      description: '',
      command: 'echo',
      args: [],
      determinism: 'best_effort',
      inputs: [{ name: 'val', from: 'ghost.outputs.x', default: 'fallback' }],
    } as StepWithIO;

    const resolved = resolveInputs(step, new Map());
    expect(resolved.val).toBe('fallback');
  });

  it('throws for missing required input', () => {
    const step: StepWithIO = {
      step_id: 's1',
      type: 'run_command',
      description: '',
      command: 'echo',
      args: [],
      determinism: 'best_effort',
      inputs: [{ name: 'val', from: 'ghost.outputs.x' }],
    } as StepWithIO;

    expect(() => resolveInputs(step, new Map())).toThrow('required input');
  });

  it('returns empty for no inputs', () => {
    const step: StepWithIO = {
      step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed',
    } as StepWithIO;
    expect(resolveInputs(step, new Map())).toEqual({});
  });
});

describe('validateStepIO', () => {
  it('validates good plan', () => {
    const issues = validateStepIO(makeSteps());
    expect(issues).toHaveLength(0);
  });

  it('reports invalid reference format', () => {
    const steps: StepWithIO[] = [{
      step_id: 's1', type: 'run_command', description: '', command: 'echo', args: [],
      determinism: 'best_effort',
      inputs: [{ name: 'x', from: 'bad-ref' }],
    } as StepWithIO];
    const issues = validateStepIO(steps);
    expect(issues.some((i) => i.includes('invalid reference'))).toBe(true);
  });

  it('reports unknown step reference', () => {
    const steps: StepWithIO[] = [{
      step_id: 's1', type: 'run_command', description: '', command: 'echo', args: [],
      determinism: 'best_effort',
      inputs: [{ name: 'x', from: 'ghost.outputs.y' }],
    } as StepWithIO];
    const issues = validateStepIO(steps);
    expect(issues.some((i) => i.includes('unknown step'))).toBe(true);
  });

  it('reports missing dependency', () => {
    const steps: StepWithIO[] = [
      { step_id: 'a', type: 'create_file', description: '', path: 'x', content: '', determinism: 'guaranteed', outputs: [{ name: 'path', value: 'x' }] } as StepWithIO,
      { step_id: 'b', type: 'run_command', description: '', command: 'echo', args: [], determinism: 'best_effort', inputs: [{ name: 'path', from: 'a.outputs.path' }] } as StepWithIO,
    ];
    const issues = validateStepIO(steps);
    expect(issues.some((i) => i.includes('depends_on'))).toBe(true);
  });
});

describe('inferDependencies', () => {
  it('adds deps from input references', () => {
    const steps: StepWithIO[] = [
      { step_id: 'a', type: 'create_file', description: '', path: 'x', content: '', determinism: 'guaranteed', outputs: [{ name: 'p' }] } as StepWithIO,
      { step_id: 'b', type: 'run_command', description: '', command: 'echo', args: [], determinism: 'best_effort', inputs: [{ name: 'p', from: 'a.outputs.p' }] } as StepWithIO,
    ];
    const inferred = inferDependencies(steps);
    expect(inferred[1].depends_on).toContain('a');
  });

  it('preserves existing deps', () => {
    const steps: StepWithIO[] = [
      { step_id: 'a', type: 'create_file', description: '', path: 'x', content: '', determinism: 'guaranteed' } as StepWithIO,
      { step_id: 'b', type: 'run_command', description: '', command: 'echo', args: [], determinism: 'best_effort', depends_on: ['a'], inputs: [{ name: 'p', from: 'a.outputs.p' }] } as StepWithIO,
    ];
    const inferred = inferDependencies(steps);
    expect(inferred[1].depends_on).toEqual(['a']);
  });
});

describe('listStepIO', () => {
  it('lists steps with I/O', () => {
    const io = listStepIO(makeSteps());
    expect(io).toHaveLength(2);
    expect(io[0].stepId).toBe('create-config');
    expect(io[0].outputs).toHaveLength(1);
    expect(io[1].inputs).toHaveLength(1);
  });
});
