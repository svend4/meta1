import { describe, it, expect } from 'vitest';
import { canonicalJson } from '../../src/core/canonical-json.js';

describe('canonicalJson', () => {
  it('produces identical output regardless of key order', () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('handles nested objects deterministically', () => {
    const a = { outer: { z: 1, a: 2 }, name: 'test' };
    const b = { name: 'test', outer: { a: 2, z: 1 } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('produces valid JSON', () => {
    const obj = { hello: 'world', num: 42, arr: [1, 2, 3] };
    const result = canonicalJson(obj);
    expect(JSON.parse(result)).toEqual(obj);
  });

  it('handles arrays (order preserved)', () => {
    const a = [3, 1, 2];
    expect(canonicalJson(a)).toBe('[3,1,2]');
  });

  it('handles strings', () => {
    expect(canonicalJson('hello')).toBe('"hello"');
  });

  it('handles null', () => {
    expect(canonicalJson(null)).toBe('null');
  });
});
