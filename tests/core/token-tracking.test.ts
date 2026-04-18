import { describe, it, expect } from 'vitest';
import { estimateCost } from '../../src/core/planner.js';
import type { TokenUsage } from '../../src/types/run-summary.js';

describe('estimateCost', () => {
  it('estimates cost for claude-sonnet', () => {
    const cost = estimateCost('claude-sonnet-4-20250514', 1000, 500);
    // Input: 1000 * 3 / 1M = 0.003, Output: 500 * 15 / 1M = 0.0075
    expect(cost).toBeCloseTo(0.0105, 4);
  });

  it('estimates cost for claude-haiku', () => {
    const cost = estimateCost('claude-haiku-4-5-20251001', 2000, 1000);
    // Input: 2000 * 0.8 / 1M = 0.0016, Output: 1000 * 4 / 1M = 0.004
    expect(cost).toBeCloseTo(0.0056, 4);
  });

  it('estimates cost for claude-opus', () => {
    const cost = estimateCost('claude-opus-4-20250514', 1000, 1000);
    // Input: 1000 * 15 / 1M = 0.015, Output: 1000 * 75 / 1M = 0.075
    expect(cost).toBeCloseTo(0.090, 3);
  });

  it('returns 0 for unknown model', () => {
    expect(estimateCost('gpt-4-unknown', 1000, 1000)).toBe(0);
  });

  it('handles zero tokens', () => {
    expect(estimateCost('claude-sonnet-4-20250514', 0, 0)).toBe(0);
  });

  it('handles large token counts', () => {
    const cost = estimateCost('claude-sonnet-4-20250514', 1_000_000, 500_000);
    // Input: 1M * 3 / 1M = 3, Output: 500K * 15 / 1M = 7.5
    expect(cost).toBeCloseTo(10.5, 1);
  });
});

describe('TokenUsage type', () => {
  it('has required fields', () => {
    const usage: TokenUsage = {
      input_tokens: 100,
      output_tokens: 50,
    };
    expect(usage.input_tokens).toBe(100);
    expect(usage.output_tokens).toBe(50);
    expect(usage.estimated_cost_usd).toBeUndefined();
  });

  it('has optional fields', () => {
    const usage: TokenUsage = {
      input_tokens: 100,
      output_tokens: 50,
      estimated_cost_usd: 0.001,
      model: 'claude-sonnet-4-20250514',
    };
    expect(usage.estimated_cost_usd).toBe(0.001);
    expect(usage.model).toBe('claude-sonnet-4-20250514');
  });
});
