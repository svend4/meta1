import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const canonicalize = require('canonicalize') as (value: unknown) => string | undefined;

/**
 * Produce a JCS (RFC 8785) canonical JSON string from any value.
 * Used to ensure deterministic hashing regardless of key ordering.
 */
export function canonicalJson(value: unknown): string {
  const result = canonicalize(value);
  if (result === undefined) {
    throw new Error('Failed to canonicalize value: unsupported type');
  }
  return result;
}
