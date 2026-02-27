import { describe, it, expect, vi } from 'vitest';
import { generateNarrative } from '../../src/core/narrative.js';
import type { RunSummary } from '../../src/types/run-summary.js';

function makeRun(overrides?: Partial<RunSummary>): RunSummary {
  return {
    run_id: 'run-narr-1',
    task_id: 'task-1',
    prompt: 'Build Express API with tests',
    status: 'completed',
    started_at: '2026-01-15T14:30:00Z',
    completed_at: '2026-01-15T14:30:45Z',
    duration_ms: 45000,
    plan: { plan_id: 'p1', steps: [{ step_id: 's1' }, { step_id: 's2' }] },
    plan_hash: 'sha256:abc',
    plan_source: 'llm',
    steps: [
      { step_id: 's1', type: 'create_file', status: 'completed', duration_ms: 100, description: 'Create server.ts' },
      { step_id: 's2', type: 'run_command', status: 'completed', duration_ms: 5000, description: 'Run tests' },
    ],
    ...overrides,
  } as RunSummary;
}

describe('generateNarrative', () => {
  it('generates a narrative for a successful run', () => {
    const narrative = generateNarrative(makeRun());
    expect(narrative).toContain('Build Express API with tests');
    expect(narrative).toContain('AI-generated');
    expect(narrative).toContain('2 steps');
    expect(narrative).toContain('completed successfully');
  });

  it('mentions all steps', () => {
    const narrative = generateNarrative(makeRun());
    expect(narrative).toContain('Create server.ts');
    expect(narrative).toContain('Run tests');
  });

  it('narrates failures', () => {
    const narrative = generateNarrative(makeRun({
      status: 'failed',
      steps: [
        { step_id: 's1', type: 'create_file', status: 'completed', duration_ms: 100, description: 'Create file' },
        { step_id: 's2', type: 'run_command', status: 'failed', duration_ms: 200, description: 'Run build', error: 'exit code 1' },
      ],
    }));
    expect(narrative).toContain('failed');
    expect(narrative).toContain('exit code 1');
  });

  it('narrates skipped steps', () => {
    const narrative = generateNarrative(makeRun({
      steps: [
        { step_id: 's1', type: 'create_file', status: 'completed', duration_ms: 100, description: 'Setup' },
        { step_id: 's2', type: 'run_command', status: 'skipped', description: 'Tests' },
      ],
    }));
    expect(narrative).toContain('skipped');
  });

  it('includes assertion narrative', () => {
    const narrative = generateNarrative(makeRun({
      assertion_results: [
        { assertion_id: 'health', type: 'http-status', passed: true, expected: '200', actual: '200', stability: 'stable', attempts: 1 },
        { assertion_id: 'coverage', type: 'percentage', passed: false, expected: '> 80%', actual: '65%', stability: 'volatile', attempts: 2 },
      ],
    }));
    expect(narrative).toContain('1 of 2 assertions passed');
    expect(narrative).toContain('coverage');
    expect(narrative).toContain('expected > 80%');
  });

  it('includes cost narrative', () => {
    const narrative = generateNarrative(makeRun({
      token_usage: { input_tokens: 5000, output_tokens: 2000, estimated_cost_usd: 0.0350 },
    }));
    expect(narrative).toContain('5,000 input tokens');
    expect(narrative).toContain('2,000 output tokens');
    expect(narrative).toContain('$0.0350');
  });

  it('generates conclusion for verified status', () => {
    const narrative = generateNarrative(makeRun({ status: 'verified' }));
    expect(narrative).toContain('verified');
  });

  it('generates conclusion for healed status', () => {
    const narrative = generateNarrative(makeRun({ status: 'healed' }));
    expect(narrative).toContain('repaired');
  });

  it('generates conclusion for assertion_failed', () => {
    const narrative = generateNarrative(makeRun({ status: 'assertion_failed' }));
    expect(narrative).toContain('assertions failed');
  });

  it('describes cached plans', () => {
    const narrative = generateNarrative(makeRun({ plan_source: 'cache' }));
    expect(narrative).toContain('cached');
  });
});
