import { describe, it, expect } from 'vitest';
import {
  resolveDependencies,
  validateDependencies,
  formatResolution,
} from '../../src/core/dep-resolver.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';

describe('resolveDependencies', () => {
  it('infers file dependency from create_file → run_command reading it', () => {
    const plan: ExecutionPlan = {
      plan_id: 'test',
      steps: [
        { step_id: 'create', type: 'create_file', description: 'Create config', path: 'config.json', content: '{}', determinism: 'guaranteed' },
        { step_id: 'read', type: 'run_command', description: 'Read config', command: 'cat', args: ['config.json'], determinism: 'guaranteed' },
      ],
    };

    const result = resolveDependencies(plan);
    expect(result.inferred.length).toBeGreaterThan(0);
    expect(result.inferred[0].fromStepId).toBe('read');
    expect(result.inferred[0].toStepId).toBe('create');
    expect(result.inferred[0].resource).toBe('config.json');
  });

  it('infers dependency from --input flag', () => {
    const plan: ExecutionPlan = {
      plan_id: 'test',
      steps: [
        { step_id: 'gen', type: 'create_file', description: 'Generate', path: 'data.csv', content: 'a,b', determinism: 'guaranteed' },
        { step_id: 'proc', type: 'run_command', description: 'Process', command: 'process', args: ['--input', 'data.csv'], determinism: 'best_effort' },
      ],
    };

    const result = resolveDependencies(plan);
    expect(result.inferred.some((d) => d.resource === 'data.csv')).toBe(true);
    expect(result.modified).toContain('proc');
  });

  it('preserves existing explicit depends_on', () => {
    const plan: ExecutionPlan = {
      plan_id: 'test',
      steps: [
        { step_id: 'a', type: 'run_command', description: 'A', command: 'echo', args: ['hi'], determinism: 'guaranteed' },
        { step_id: 'b', type: 'run_command', description: 'B', command: 'echo', args: ['bye'], determinism: 'guaranteed', depends_on: ['a'] },
      ],
    };

    const result = resolveDependencies(plan);
    expect(result.steps[1].depends_on).toContain('a');
  });

  it('computes execution order', () => {
    const plan: ExecutionPlan = {
      plan_id: 'test',
      steps: [
        { step_id: 'first', type: 'create_file', description: 'Create', path: 'out.txt', content: 'hi', determinism: 'guaranteed' },
        { step_id: 'second', type: 'run_command', description: 'Read', command: 'cat', args: ['out.txt'], determinism: 'guaranteed' },
      ],
    };

    const result = resolveDependencies(plan);
    const firstIdx = result.executionOrder.indexOf('first');
    const secondIdx = result.executionOrder.indexOf('second');
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it('computes max parallelism', () => {
    const plan: ExecutionPlan = {
      plan_id: 'test',
      steps: [
        { step_id: 'a', type: 'create_file', description: 'A', path: 'a.txt', content: '', determinism: 'guaranteed' },
        { step_id: 'b', type: 'create_file', description: 'B', path: 'b.txt', content: '', determinism: 'guaranteed' },
        { step_id: 'c', type: 'create_file', description: 'C', path: 'c.txt', content: '', determinism: 'guaranteed' },
      ],
    };

    const result = resolveDependencies(plan);
    expect(result.maxParallelism).toBe(3); // All independent
  });

  it('handles plan with no dependencies', () => {
    const plan: ExecutionPlan = {
      plan_id: 'test',
      steps: [
        { step_id: 'a', type: 'run_command', description: 'Echo', command: 'echo', args: ['hi'], determinism: 'guaranteed' },
      ],
    };

    const result = resolveDependencies(plan);
    expect(result.inferred).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  });

  it('infers write command dependency', () => {
    const plan: ExecutionPlan = {
      plan_id: 'test',
      steps: [
        { step_id: 'gen', type: 'create_file', description: 'Gen', path: 'src.txt', content: 'x', determinism: 'guaranteed' },
        { step_id: 'copy', type: 'run_command', description: 'Copy', command: 'cp', args: ['src.txt', 'dest.txt'], determinism: 'guaranteed' },
      ],
    };

    const result = resolveDependencies(plan);
    // cp reads src.txt (it's a file path arg in a write command)
    expect(result.executionOrder[0]).toBe('gen');
  });
});

describe('validateDependencies', () => {
  it('passes valid plan', () => {
    const plan: ExecutionPlan = {
      plan_id: 'test',
      steps: [
        { step_id: 'a', type: 'create_file', description: 'A', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 'b', type: 'create_file', description: 'B', path: 'b', content: '', determinism: 'guaranteed', depends_on: ['a'] },
      ],
    };

    expect(validateDependencies(plan)).toHaveLength(0);
  });

  it('detects unknown dependency', () => {
    const plan: ExecutionPlan = {
      plan_id: 'test',
      steps: [
        { step_id: 'a', type: 'create_file', description: 'A', path: 'a', content: '', determinism: 'guaranteed', depends_on: ['ghost'] },
      ],
    };

    const issues = validateDependencies(plan);
    expect(issues.some((i) => i.includes('ghost'))).toBe(true);
  });

  it('detects cycles', () => {
    const plan: ExecutionPlan = {
      plan_id: 'test',
      steps: [
        { step_id: 'a', type: 'create_file', description: 'A', path: 'a', content: '', determinism: 'guaranteed', depends_on: ['b'] },
        { step_id: 'b', type: 'create_file', description: 'B', path: 'b', content: '', determinism: 'guaranteed', depends_on: ['a'] },
      ],
    };

    const issues = validateDependencies(plan);
    expect(issues.some((i) => i.includes('cycle'))).toBe(true);
  });
});

describe('formatResolution', () => {
  it('formats resolution result', () => {
    const plan: ExecutionPlan = {
      plan_id: 'test',
      steps: [
        { step_id: 'a', type: 'create_file', description: 'A', path: 'data.txt', content: 'x', determinism: 'guaranteed' },
        { step_id: 'b', type: 'run_command', description: 'B', command: 'cat', args: ['data.txt'], determinism: 'guaranteed' },
      ],
    };

    const result = resolveDependencies(plan);
    const output = formatResolution(result);
    expect(output).toContain('Dependency Resolution');
    expect(output).toContain('data.txt');
  });
});
