import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';

/** Compute sha256 hash of a raw string, returned as "sha256:<hex>" */
export function hashString(input: string): `sha256:${string}` {
  const hex = createHash('sha256').update(input, 'utf8').digest('hex');
  return `sha256:${hex}`;
}

/** Compute sha256 hash of a Buffer, returned as "sha256:<hex>" */
export function hashBuffer(input: Buffer): `sha256:${string}` {
  const hex = createHash('sha256').update(input).digest('hex');
  return `sha256:${hex}`;
}

/**
 * Compute sha256 hash of an object by first canonicalizing it (JCS).
 * Ensures identical objects hash identically regardless of key order.
 */
export function hashObject(value: unknown): `sha256:${string}` {
  return hashString(canonicalJson(value));
}

/**
 * Compute the plan cache key from task parameters.
 * cache_key = sha256(JCS({ prompt, context_hash, model, system_prompt_hash }))
 */
export function computeCacheKey(params: {
  prompt: string;
  context?: Record<string, unknown>;
  model: string;
  systemPromptHash: `sha256:${string}`;
}): `sha256:${string}` {
  const contextHash = params.context
    ? hashObject(params.context)
    : hashString('');

  return hashObject({
    prompt: params.prompt,
    context_hash: contextHash,
    model: params.model,
    system_prompt_hash: params.systemPromptHash,
  });
}

/**
 * Combine multiple artifact hashes into a single run hash.
 * Hashes are sorted and concatenated before hashing.
 */
export function computeRunHash(
  artifactHashes: `sha256:${string}`[],
): `sha256:${string}` {
  const sorted = [...artifactHashes].sort();
  return hashString(sorted.join('\n'));
}
