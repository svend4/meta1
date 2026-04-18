import { describe, it, expect } from 'vitest';
import { extractJson } from '../../src/core/repair-compiler.js';

describe('extractJson', () => {
  it('returns clean JSON as-is', () => {
    const input = '{"key": "value"}';
    expect(extractJson(input)).toBe('{"key": "value"}');
  });

  it('strips markdown code fences', () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(JSON.parse(extractJson(input))).toEqual({ key: 'value' });
  });

  it('strips markdown code fences without language tag', () => {
    const input = '```\n{"key": "value"}\n```';
    expect(JSON.parse(extractJson(input))).toEqual({ key: 'value' });
  });

  it('extracts JSON from surrounding text', () => {
    const input = 'Here is the result:\n{"repaired_plan": {}, "mutations": []}\nDone.';
    const parsed = JSON.parse(extractJson(input));
    expect(parsed.repaired_plan).toEqual({});
  });

  it('handles nested braces correctly', () => {
    const input = 'Output: {"a": {"b": {"c": 1}}, "d": 2}';
    const parsed = JSON.parse(extractJson(input));
    expect(parsed.a.b.c).toBe(1);
    expect(parsed.d).toBe(2);
  });

  it('handles leading whitespace', () => {
    const input = '   \n  {"key": "value"}  \n  ';
    expect(JSON.parse(extractJson(input))).toEqual({ key: 'value' });
  });

  it('handles code fence with JSON flag case-insensitive', () => {
    const input = '```JSON\n{"key": "value"}\n```';
    expect(JSON.parse(extractJson(input))).toEqual({ key: 'value' });
  });

  it('returns raw text when no braces found', () => {
    const input = 'no json here';
    expect(extractJson(input)).toBe('no json here');
  });
});
