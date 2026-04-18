import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getBaseDir } from './paths.js';
import { hashObject } from './hasher.js';
import type { Step, CreateFileStep, RunCommandStep } from '../types/execution-plan.js';

/** Step cache directory: ~/.continuum/cache/steps */
function getStepCacheDir(): string {
  return join(getBaseDir(), 'cache', 'steps');
}

/** A cached step result */
export interface StepCacheEntry {
  step_id: string;
  input_hash: `sha256:${string}`;
  artifact_hash: `sha256:${string}`;
  created_at: string;
  /** Captured output for run_command steps */
  stdout?: string;
  stderr?: string;
}

/**
 * Compute an input hash for a step based on its definition.
 * For create_file: hash of path + content.
 * For run_command: hash of command + args + env.
 */
export function computeStepInputHash(step: Step): `sha256:${string}` {
  if (step.type === 'create_file') {
    const cf = step as CreateFileStep;
    return hashObject({ type: 'create_file', path: cf.path, content: cf.content });
  }
  const rc = step as RunCommandStep;
  return hashObject({
    type: 'run_command',
    command: rc.command,
    args: rc.args,
    env: rc.env ?? {},
  });
}

/**
 * Look up a cached result for a step.
 * Returns the cached entry if the input hash matches.
 */
export function lookupStepCache(step: Step): StepCacheEntry | null {
  const dir = getStepCacheDir();
  const inputHash = computeStepInputHash(step);
  const cacheFile = join(dir, `${step.step_id}.json`);

  if (!existsSync(cacheFile)) return null;

  try {
    const entry = JSON.parse(readFileSync(cacheFile, 'utf8')) as StepCacheEntry;
    if (entry.input_hash === inputHash) {
      return entry;
    }
    // Input changed — cache miss
    return null;
  } catch {
    return null;
  }
}

/**
 * Store a step result in the cache.
 */
export function storeStepCache(
  step: Step,
  artifactHash: `sha256:${string}`,
  output?: { stdout?: string; stderr?: string },
): void {
  const dir = getStepCacheDir();
  mkdirSync(dir, { recursive: true });

  const entry: StepCacheEntry = {
    step_id: step.step_id,
    input_hash: computeStepInputHash(step),
    artifact_hash: artifactHash,
    created_at: new Date().toISOString(),
    ...(output?.stdout !== undefined ? { stdout: output.stdout } : {}),
    ...(output?.stderr !== undefined ? { stderr: output.stderr } : {}),
  };

  writeFileSync(join(dir, `${step.step_id}.json`), JSON.stringify(entry, null, 2), 'utf8');
}

/**
 * Clear all step cache entries.
 */
export function clearStepCache(): number {
  const dir = getStepCacheDir();
  if (!existsSync(dir)) return 0;

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    unlinkSync(join(dir, file));
  }
  return files.length;
}

/**
 * Get step cache statistics.
 */
export function getStepCacheStats(): { entries: number; totalBytes: number } {
  const dir = getStepCacheDir();
  if (!existsSync(dir)) return { entries: 0, totalBytes: 0 };

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  let totalBytes = 0;
  for (const file of files) {
    const content = readFileSync(join(dir, file), 'utf8');
    totalBytes += Buffer.byteLength(content, 'utf8');
  }

  return { entries: files.length, totalBytes };
}
