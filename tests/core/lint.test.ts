import { describe, it, expect } from 'vitest';
import { lintPlan, formatLintResult } from '../../src/core/lint.js';
import type { ExecutionPlan, CreateFileStep, RunCommandStep } from '../../src/types/execution-plan.js';

function makePlan(steps: Array<CreateFileStep | RunCommandStep>): ExecutionPlan {
  return { plan_id: 'test-plan', steps };
}

function fileStep(id: string, path: string, content = 'hello'): CreateFileStep {
  return { step_id: id, type: 'create_file', description: 'Create file', path, content, determinism: 'guaranteed' };
}

function cmdStep(id: string, command: string, args: string[] = []): RunCommandStep {
  return { step_id: id, type: 'run_command', description: 'Run', command, args, determinism: 'best_effort' };
}

describe('lintPlan', () => {
  it('passes clean plan', () => {
    const plan = makePlan([
      fileStep('s1', 'index.js'),
      cmdStep('s2', 'node', ['index.js']),
    ]);
    const result = lintPlan(plan);
    expect(result.passed).toBe(true);
    expect(result.errors).toBe(0);
  });

  it('detects duplicate step IDs', () => {
    const plan = makePlan([
      fileStep('dup', 'a.js'),
      fileStep('dup', 'b.js'),
    ]);
    const result = lintPlan(plan);
    expect(result.errors).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.rule === 'duplicate-step-id')).toBe(true);
  });

  it('warns on empty plan', () => {
    const result = lintPlan(makePlan([]));
    expect(result.warnings).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.rule === 'empty-plan')).toBe(true);
  });

  it('warns on file conflicts', () => {
    const plan = makePlan([
      fileStep('s1', 'config.json', '{"a":1}'),
      fileStep('s2', 'config.json', '{"b":2}'),
    ]);
    const result = lintPlan(plan);
    expect(result.findings.some((f) => f.rule === 'file-conflict')).toBe(true);
  });

  it('warns on unsafe commands', () => {
    const plan = makePlan([cmdStep('s1', 'rm', ['-rf', '/tmp/test'])]);
    const result = lintPlan(plan);
    expect(result.findings.some((f) => f.rule === 'unsafe-command')).toBe(true);
  });

  it('warns on unsafe args', () => {
    const plan = makePlan([cmdStep('s1', 'find', ['.', '-delete', '--force'])]);
    const result = lintPlan(plan);
    expect(result.findings.some((f) => f.rule === 'unsafe-args')).toBe(true);
  });

  it('detects empty command', () => {
    const plan = makePlan([cmdStep('s1', '', [])]);
    const result = lintPlan(plan);
    expect(result.errors).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.rule === 'empty-command')).toBe(true);
  });

  it('warns on absolute paths', () => {
    const plan = makePlan([fileStep('s1', '/etc/config.json')]);
    const result = lintPlan(plan);
    expect(result.findings.some((f) => f.rule === 'absolute-path')).toBe(true);
  });

  it('warns on large file content', () => {
    const plan = makePlan([fileStep('s1', 'big.dat', 'x'.repeat(200_000))]);
    const result = lintPlan(plan);
    expect(result.findings.some((f) => f.rule === 'large-file')).toBe(true);
  });

  it('warns on missing install step', () => {
    const plan = makePlan([
      fileStep('s1', 'package.json', '{}'),
      cmdStep('s2', 'node', ['index.js']),
    ]);
    const result = lintPlan(plan);
    expect(result.findings.some((f) => f.rule === 'missing-install')).toBe(true);
  });

  it('no missing-install warning when install step present', () => {
    const plan = makePlan([
      fileStep('s1', 'package.json', '{}'),
      cmdStep('s2', 'npm', ['install']),
      cmdStep('s3', 'node', ['index.js']),
    ]);
    const result = lintPlan(plan);
    expect(result.findings.some((f) => f.rule === 'missing-install')).toBe(false);
  });

  it('detects invalid dependency references', () => {
    const step = cmdStep('s1', 'echo', ['hi']);
    step.depends_on = ['nonexistent'];
    const plan = makePlan([step]);
    const result = lintPlan(plan);
    expect(result.errors).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.rule === 'invalid-dependency')).toBe(true);
  });

  it('info on shell piping', () => {
    const plan = makePlan([cmdStep('s1', 'bash', ['-c', 'echo hello | grep hello'])]);
    const result = lintPlan(plan);
    expect(result.findings.some((f) => f.rule === 'shell-pipe')).toBe(true);
  });
});

describe('formatLintResult', () => {
  it('formats no issues', () => {
    const plan = makePlan([fileStep('s1', 'a.js')]);
    const result = lintPlan(plan);
    const output = formatLintResult(result);
    expect(output).toContain('No issues found');
  });

  it('formats findings with counts', () => {
    const plan = makePlan([cmdStep('s1', 'rm', ['-rf', '/'])]);
    const result = lintPlan(plan);
    const output = formatLintResult(result);
    expect(output).toContain('WRN');
    expect(output).toContain('warnings');
  });
});
