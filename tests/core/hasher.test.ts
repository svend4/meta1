import { describe, it, expect } from 'vitest';
import {
  hashString,
  hashBuffer,
  hashObject,
  computeCacheKey,
  computeRunHash,
} from '../../src/core/hasher.js';

describe('hashString', () => {
  it('returns sha256-prefixed hex string', () => {
    const result = hashString('hello');
    expect(result).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashString('test')).toBe(hashString('test'));
  });

  it('differs for different inputs', () => {
    expect(hashString('a')).not.toBe(hashString('b'));
  });

  it('matches known sha256 of empty string', () => {
    // sha256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(hashString('')).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('hashBuffer', () => {
  it('returns sha256-prefixed hex string', () => {
    const result = hashBuffer(Buffer.from('hello'));
    expect(result).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('matches hashString for same content', () => {
    expect(hashBuffer(Buffer.from('test'))).toBe(hashString('test'));
  });
});

describe('hashObject', () => {
  it('is deterministic regardless of key order', () => {
    const a = { z: 1, a: 2 };
    const b = { a: 2, z: 1 };
    expect(hashObject(a)).toBe(hashObject(b));
  });

  it('differs for different objects', () => {
    expect(hashObject({ a: 1 })).not.toBe(hashObject({ a: 2 }));
  });
});

describe('computeCacheKey', () => {
  const base = {
    prompt: 'build Express API',
    model: 'claude-sonnet-4-20250514',
    systemPromptHash: 'sha256:abc123' as `sha256:${string}`,
  };

  it('same prompt + context → same cache_key', () => {
    const a = computeCacheKey({ ...base, context: { files: ['a.ts'] } });
    const b = computeCacheKey({ ...base, context: { files: ['a.ts'] } });
    expect(a).toBe(b);
  });

  it('different prompt → different cache_key', () => {
    const a = computeCacheKey({ ...base, prompt: 'build Express API' });
    const b = computeCacheKey({ ...base, prompt: 'build Fastify API' });
    expect(a).not.toBe(b);
  });

  it('different model → different cache_key', () => {
    const a = computeCacheKey({ ...base, model: 'claude-sonnet-4-20250514' });
    const b = computeCacheKey({ ...base, model: 'claude-haiku-4-5-20251001' });
    expect(a).not.toBe(b);
  });

  it('different system prompt hash → different cache_key', () => {
    const a = computeCacheKey({
      ...base,
      systemPromptHash: 'sha256:aaa' as `sha256:${string}`,
    });
    const b = computeCacheKey({
      ...base,
      systemPromptHash: 'sha256:bbb' as `sha256:${string}`,
    });
    expect(a).not.toBe(b);
  });

  it('no context vs empty context produces different keys', () => {
    const a = computeCacheKey({ ...base });
    const b = computeCacheKey({ ...base, context: {} });
    expect(a).not.toBe(b);
  });
});

describe('computeRunHash', () => {
  it('combines multiple artifact hashes deterministically', () => {
    const hashes: `sha256:${string}`[] = [
      'sha256:aaa',
      'sha256:bbb',
      'sha256:ccc',
    ];
    const a = computeRunHash(hashes);
    const b = computeRunHash(hashes);
    expect(a).toBe(b);
  });

  it('is order-independent (sorted internally)', () => {
    const a = computeRunHash(['sha256:bbb', 'sha256:aaa']);
    const b = computeRunHash(['sha256:aaa', 'sha256:bbb']);
    expect(a).toBe(b);
  });
});
