/**
 * Environment manager — manage named environments with variables,
 * secrets masking, and environment promotion (dev → staging → prod).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getBaseDir } from './paths.js';

/** A variable in an environment */
export interface EnvVariable {
  key: string;
  value: string;
  /** Whether this is a secret (masked in output) */
  secret: boolean;
  /** Optional description */
  description?: string;
}

/** A named environment */
export interface Environment {
  name: string;
  description?: string;
  variables: EnvVariable[];
  createdAt: string;
  updatedAt: string;
  /** Parent environment to inherit from */
  inherits?: string;
}

/** Result of promoting an environment */
export interface PromotionResult {
  from: string;
  to: string;
  added: string[];
  updated: string[];
  kept: string[];
}

function getEnvsDir(): string {
  return join(getBaseDir(), 'environments');
}

function getEnvPath(name: string): string {
  return join(getEnvsDir(), `${name}.json`);
}

/**
 * Create or update a named environment.
 */
export function saveEnvironment(env: Environment): void {
  const dir = getEnvsDir();
  mkdirSync(dir, { recursive: true });
  env.updatedAt = new Date().toISOString();
  writeFileSync(getEnvPath(env.name), JSON.stringify(env, null, 2), 'utf8');
}

/**
 * Load an environment by name, resolving inheritance.
 */
export function loadEnvironment(name: string): Environment | null {
  const path = getEnvPath(name);
  if (!existsSync(path)) return null;

  const env = JSON.parse(readFileSync(path, 'utf8')) as Environment;

  // Resolve inheritance
  if (env.inherits) {
    const parent = loadEnvironment(env.inherits);
    if (parent) {
      const childKeys = new Set(env.variables.map((v) => v.key));
      const inherited = parent.variables.filter((v) => !childKeys.has(v.key));
      env.variables = [...inherited, ...env.variables];
    }
  }

  return env;
}

/**
 * Load raw environment (without inheritance resolution).
 */
export function loadRawEnvironment(name: string): Environment | null {
  const path = getEnvPath(name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Environment;
}

/**
 * List all environments.
 */
export function listEnvironments(): Environment[] {
  const dir = getEnvsDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Environment)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Delete an environment.
 */
export function deleteEnvironment(name: string): boolean {
  const path = getEnvPath(name);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/**
 * Set a variable in an environment.
 */
export function setVariable(
  envName: string,
  key: string,
  value: string,
  options?: { secret?: boolean; description?: string },
): void {
  const env = loadRawEnvironment(envName);
  if (!env) throw new Error(`Environment not found: ${envName}`);

  const existing = env.variables.find((v) => v.key === key);
  if (existing) {
    existing.value = value;
    if (options?.secret !== undefined) existing.secret = options.secret;
    if (options?.description) existing.description = options.description;
  } else {
    env.variables.push({
      key,
      value,
      secret: options?.secret ?? false,
      description: options?.description,
    });
  }

  saveEnvironment(env);
}

/**
 * Remove a variable from an environment.
 */
export function removeVariable(envName: string, key: string): boolean {
  const env = loadRawEnvironment(envName);
  if (!env) throw new Error(`Environment not found: ${envName}`);

  const before = env.variables.length;
  env.variables = env.variables.filter((v) => v.key !== key);

  if (env.variables.length < before) {
    saveEnvironment(env);
    return true;
  }
  return false;
}

/**
 * Resolve environment variables to a flat Record for step execution.
 * Secrets are included as-is (masking is for display only).
 */
export function resolveEnvVars(envName: string): Record<string, string> {
  const env = loadEnvironment(envName);
  if (!env) throw new Error(`Environment not found: ${envName}`);

  const vars: Record<string, string> = {};
  for (const v of env.variables) {
    vars[v.key] = v.value;
  }
  return vars;
}

/**
 * Promote variables from one environment to another.
 * Copies variables that don't exist in the target or updates ones with matching keys.
 */
export function promoteEnvironment(
  fromName: string,
  toName: string,
  options?: { overwrite?: boolean; keys?: string[] },
): PromotionResult {
  const from = loadEnvironment(fromName);
  if (!from) throw new Error(`Source environment not found: ${fromName}`);

  let to = loadRawEnvironment(toName);
  if (!to) {
    to = {
      name: toName,
      variables: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  const overwrite = options?.overwrite ?? false;
  const keyFilter = options?.keys ? new Set(options.keys) : null;

  const added: string[] = [];
  const updated: string[] = [];
  const kept: string[] = [];

  const toKeys = new Map(to.variables.map((v) => [v.key, v]));

  for (const fromVar of from.variables) {
    if (keyFilter && !keyFilter.has(fromVar.key)) continue;

    const existing = toKeys.get(fromVar.key);
    if (!existing) {
      to.variables.push({ ...fromVar });
      added.push(fromVar.key);
    } else if (overwrite) {
      existing.value = fromVar.value;
      existing.secret = fromVar.secret;
      updated.push(fromVar.key);
    } else {
      kept.push(fromVar.key);
    }
  }

  saveEnvironment(to);

  return { from: fromName, to: toName, added, updated, kept };
}

/**
 * Format environment for display with secret masking.
 */
export function formatEnvironment(env: Environment): string {
  const lines: string[] = [];
  lines.push(`Environment: ${env.name}`);
  if (env.description) lines.push(`  ${env.description}`);
  if (env.inherits) lines.push(`  Inherits from: ${env.inherits}`);
  lines.push(`  Variables: ${env.variables.length}`);
  lines.push('');

  for (const v of env.variables) {
    const display = v.secret ? '********' : v.value;
    const tag = v.secret ? ' [secret]' : '';
    const desc = v.description ? ` — ${v.description}` : '';
    lines.push(`  ${v.key}=${display}${tag}${desc}`);
  }

  return lines.join('\n');
}
