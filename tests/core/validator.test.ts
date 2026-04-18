import { describe, it, expect } from 'vitest';
import {
  validateExecutionPlan,
  assertValidPlan,
  validateTaskSpecData,
} from '../../src/core/validator.js';

const validPlan = {
  plan_id: '550e8400-e29b-41d4-a716-446655440000',
  steps: [
    {
      step_id: 'step-1',
      type: 'create_file',
      description: 'Create package.json',
      path: 'package.json',
      content: '{"name": "test"}',
      determinism: 'guaranteed',
    },
    {
      step_id: 'step-2',
      type: 'run_command',
      description: 'Install dependencies',
      command: 'npm',
      args: ['install', '--save-exact'],
      determinism: 'best_effort',
    },
  ],
};

const validPlanWithSignature = {
  ...validPlan,
  planner_signature: {
    planner_model: 'claude-sonnet-4-20250514',
    system_prompt_hash:
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    generated_at: '2025-01-15T10:30:00.000Z',
  },
};

describe('validateExecutionPlan', () => {
  it('accepts a valid plan', () => {
    const result = validateExecutionPlan(validPlan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a valid plan with planner_signature', () => {
    const result = validateExecutionPlan(validPlanWithSignature);
    expect(result.valid).toBe(true);
  });

  it('rejects plan without steps', () => {
    const result = validateExecutionPlan({ plan_id: 'abc' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects plan with empty steps', () => {
    const result = validateExecutionPlan({ plan_id: 'abc', steps: [] });
    expect(result.valid).toBe(false);
  });

  it('rejects plan with invalid step type', () => {
    const result = validateExecutionPlan({
      plan_id: 'abc',
      steps: [{ step_id: 's1', type: 'invalid', description: 'x' }],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects invalid system_prompt_hash format in signature', () => {
    const result = validateExecutionPlan({
      ...validPlan,
      planner_signature: {
        planner_model: 'claude-sonnet-4-20250514',
        system_prompt_hash: 'not-valid-hash',
        generated_at: '2025-01-15T10:30:00.000Z',
      },
    });
    expect(result.valid).toBe(false);
  });

  it('works without planner_signature (manual plans)', () => {
    const result = validateExecutionPlan(validPlan);
    expect(result.valid).toBe(true);
  });
});

describe('assertValidPlan', () => {
  it('does not throw for valid plan', () => {
    expect(() => assertValidPlan(validPlan)).not.toThrow();
  });

  it('throws descriptive error for invalid plan', () => {
    expect(() => assertValidPlan({ bad: true })).toThrow('Invalid ExecutionPlan');
  });
});

describe('validateTaskSpecData', () => {
  it('accepts valid task spec', () => {
    const result = validateTaskSpecData({
      task_id: '550e8400-e29b-41d4-a716-446655440000',
      prompt: 'Build an Express API',
      model: 'claude-sonnet-4-20250514',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects task spec without prompt', () => {
    const result = validateTaskSpecData({
      task_id: 'abc',
      model: 'claude-sonnet-4-20250514',
    });
    expect(result.valid).toBe(false);
  });
});
