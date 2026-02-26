import { describe, it, expect } from 'vitest';
import { inferIOSignature, validateIOSignature } from '../../src/core/io-signature.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';
import type { PlanIOSignature } from '../../src/types/plan-io-signature.js';

function makePlan(steps: ExecutionPlan['steps'], sig?: PlanIOSignature): ExecutionPlan & { plan_signature?: PlanIOSignature } {
  return {
    plan_id: 'test-plan',
    steps,
    plan_signature: sig,
  };
}

describe('inferIOSignature', () => {
  it('extracts exported files from create_file steps', () => {
    const plan = makePlan([
      { step_id: 's1', type: 'create_file', description: '', path: 'src/index.ts', content: 'code', determinism: 'guaranteed' },
      { step_id: 's2', type: 'create_file', description: '', path: 'package.json', content: '{}', determinism: 'guaranteed' },
    ]);

    const sig = inferIOSignature(plan);
    expect(sig.exports?.artifacts).toEqual(['package.json', 'src/index.ts']);
  });

  it('infers input files from depends_on referencing create_file steps', () => {
    const plan = makePlan([
      { step_id: 'create-cfg', type: 'create_file', description: '', path: 'config.json', content: '{}', determinism: 'guaranteed' },
      { step_id: 'run-cmd', type: 'run_command', description: '', command: 'node', args: ['app.js'], determinism: 'guaranteed', depends_on: ['create-cfg'] },
    ]);

    const sig = inferIOSignature(plan);
    expect(sig.inputs?.files).toEqual(['config.json']);
  });

  it('detects environment variables in command args', () => {
    const plan = makePlan([
      { step_id: 'cmd', type: 'run_command', description: '', command: 'curl', args: ['-H', 'Authorization: Bearer $API_KEY', '${BASE_URL}/data'], determinism: 'best_effort' },
    ]);

    const sig = inferIOSignature(plan);
    expect(sig.inputs?.env_vars).toEqual(['API_KEY', 'BASE_URL']);
  });

  it('returns empty inputs when no dependencies exist', () => {
    const plan = makePlan([
      { step_id: 's1', type: 'create_file', description: '', path: 'a.txt', content: 'a', determinism: 'guaranteed' },
    ]);

    const sig = inferIOSignature(plan);
    expect(sig.inputs?.files).toBeUndefined();
    expect(sig.inputs?.env_vars).toBeUndefined();
  });

  it('handles mixed step types', () => {
    const plan = makePlan([
      { step_id: 'init', type: 'create_file', description: '', path: 'setup.sh', content: '#!/bin/bash', determinism: 'guaranteed' },
      { step_id: 'run', type: 'run_command', description: '', command: 'bash', args: ['setup.sh'], determinism: 'best_effort', depends_on: ['init'] },
      { step_id: 'output', type: 'create_file', description: '', path: 'result.txt', content: 'done', determinism: 'guaranteed', depends_on: ['run'] },
    ]);

    const sig = inferIOSignature(plan);
    expect(sig.inputs?.files).toEqual(['setup.sh']);
    expect(sig.exports?.artifacts).toEqual(['result.txt', 'setup.sh']);
  });

  it('deduplicates input references', () => {
    const plan = makePlan([
      { step_id: 'cfg', type: 'create_file', description: '', path: 'config.json', content: '{}', determinism: 'guaranteed' },
      { step_id: 'cmd1', type: 'run_command', description: '', command: 'node', args: ['a.js'], determinism: 'guaranteed', depends_on: ['cfg'] },
      { step_id: 'cmd2', type: 'run_command', description: '', command: 'node', args: ['b.js'], determinism: 'guaranteed', depends_on: ['cfg'] },
    ]);

    const sig = inferIOSignature(plan);
    expect(sig.inputs?.files).toEqual(['config.json']);
  });
});

describe('validateIOSignature', () => {
  it('returns no issues when signature matches steps', () => {
    const plan = makePlan(
      [
        { step_id: 's1', type: 'create_file', description: '', path: 'out.txt', content: 'x', determinism: 'guaranteed' },
      ],
      { exports: { artifacts: ['out.txt'] } },
    );

    expect(validateIOSignature(plan)).toEqual([]);
  });

  it('detects undeclared exports', () => {
    const plan = makePlan(
      [
        { step_id: 's1', type: 'create_file', description: '', path: 'a.txt', content: 'a', determinism: 'guaranteed' },
        { step_id: 's2', type: 'create_file', description: '', path: 'b.txt', content: 'b', determinism: 'guaranteed' },
      ],
      { exports: { artifacts: ['a.txt'] } },
    );

    const issues = validateIOSignature(plan);
    expect(issues.length).toBe(1);
    expect(issues[0]).toMatch(/b\.txt.*not declared/);
  });

  it('detects phantom exports (declared but not produced)', () => {
    const plan = makePlan(
      [
        { step_id: 's1', type: 'create_file', description: '', path: 'a.txt', content: 'a', determinism: 'guaranteed' },
      ],
      { exports: { artifacts: ['a.txt', 'phantom.txt'] } },
    );

    const issues = validateIOSignature(plan);
    expect(issues.length).toBe(1);
    expect(issues[0]).toMatch(/phantom\.txt.*not produced/);
  });

  it('detects phantom inputs', () => {
    const plan = makePlan(
      [
        { step_id: 's1', type: 'create_file', description: '', path: 'a.txt', content: 'a', determinism: 'guaranteed' },
      ],
      {
        inputs: { files: ['nonexistent.json'] },
        exports: { artifacts: ['a.txt'] },
      },
    );

    const issues = validateIOSignature(plan);
    expect(issues.some((i) => i.includes('nonexistent.json'))).toBe(true);
  });

  it('returns empty when no signature declared', () => {
    const plan = makePlan([
      { step_id: 's1', type: 'create_file', description: '', path: 'a.txt', content: 'a', determinism: 'guaranteed' },
    ]);

    expect(validateIOSignature(plan)).toEqual([]);
  });
});
