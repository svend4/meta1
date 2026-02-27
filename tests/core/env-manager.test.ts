import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  saveEnvironment,
  loadEnvironment,
  loadRawEnvironment,
  listEnvironments,
  deleteEnvironment,
  setVariable,
  removeVariable,
  resolveEnvVars,
  promoteEnvironment,
  formatEnvironment,
} from '../../src/core/env-manager.js';
import type { Environment } from '../../src/core/env-manager.js';

let tempDir: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
}));

function makeEnv(name: string, vars?: Environment['variables']): Environment {
  return {
    name,
    variables: vars ?? [
      { key: 'API_URL', value: 'http://localhost:3000', secret: false },
      { key: 'API_KEY', value: 'secret123', secret: true, description: 'API key' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('env-manager', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-env-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves and loads an environment', () => {
    saveEnvironment(makeEnv('dev'));
    const env = loadEnvironment('dev');
    expect(env).toBeDefined();
    expect(env!.name).toBe('dev');
    expect(env!.variables).toHaveLength(2);
  });

  it('lists environments', () => {
    saveEnvironment(makeEnv('dev'));
    saveEnvironment(makeEnv('staging'));
    expect(listEnvironments()).toHaveLength(2);
  });

  it('deletes environment', () => {
    saveEnvironment(makeEnv('dev'));
    expect(deleteEnvironment('dev')).toBe(true);
    expect(loadEnvironment('dev')).toBeNull();
  });

  it('returns false for nonexistent delete', () => {
    expect(deleteEnvironment('ghost')).toBe(false);
  });

  it('returns null for nonexistent load', () => {
    expect(loadEnvironment('ghost')).toBeNull();
  });

  it('sets a variable', () => {
    saveEnvironment(makeEnv('dev'));
    setVariable('dev', 'NEW_VAR', 'hello');

    const env = loadEnvironment('dev');
    expect(env!.variables.find((v) => v.key === 'NEW_VAR')?.value).toBe('hello');
  });

  it('updates existing variable', () => {
    saveEnvironment(makeEnv('dev'));
    setVariable('dev', 'API_URL', 'http://prod.example.com');

    const env = loadEnvironment('dev');
    expect(env!.variables.find((v) => v.key === 'API_URL')?.value).toBe('http://prod.example.com');
  });

  it('removes a variable', () => {
    saveEnvironment(makeEnv('dev'));
    expect(removeVariable('dev', 'API_URL')).toBe(true);

    const env = loadEnvironment('dev');
    expect(env!.variables.find((v) => v.key === 'API_URL')).toBeUndefined();
  });

  it('returns false for removing nonexistent variable', () => {
    saveEnvironment(makeEnv('dev'));
    expect(removeVariable('dev', 'GHOST')).toBe(false);
  });

  it('throws for variable ops on nonexistent env', () => {
    expect(() => setVariable('ghost', 'X', 'Y')).toThrow('not found');
    expect(() => removeVariable('ghost', 'X')).toThrow('not found');
  });

  it('resolves env vars to flat record', () => {
    saveEnvironment(makeEnv('dev'));
    const vars = resolveEnvVars('dev');

    expect(vars.API_URL).toBe('http://localhost:3000');
    expect(vars.API_KEY).toBe('secret123');
  });

  it('resolves inherited variables', () => {
    saveEnvironment(makeEnv('base', [
      { key: 'SHARED', value: 'base-val', secret: false },
      { key: 'OVERRIDE', value: 'base', secret: false },
    ]));

    const child = makeEnv('dev', [
      { key: 'OVERRIDE', value: 'dev', secret: false },
      { key: 'DEV_ONLY', value: 'yes', secret: false },
    ]);
    child.inherits = 'base';
    saveEnvironment(child);

    const env = loadEnvironment('dev');
    expect(env!.variables.find((v) => v.key === 'SHARED')?.value).toBe('base-val');
    expect(env!.variables.find((v) => v.key === 'OVERRIDE')?.value).toBe('dev');
    expect(env!.variables.find((v) => v.key === 'DEV_ONLY')?.value).toBe('yes');
  });

  it('promotes variables between environments', () => {
    saveEnvironment(makeEnv('dev'));
    saveEnvironment(makeEnv('staging', []));

    const result = promoteEnvironment('dev', 'staging');
    expect(result.added).toHaveLength(2);

    const staging = loadEnvironment('staging');
    expect(staging!.variables).toHaveLength(2);
  });

  it('promotes with overwrite', () => {
    saveEnvironment(makeEnv('dev'));
    saveEnvironment(makeEnv('staging', [
      { key: 'API_URL', value: 'old', secret: false },
    ]));

    const result = promoteEnvironment('dev', 'staging', { overwrite: true });
    expect(result.updated).toContain('API_URL');
  });

  it('promotes with key filter', () => {
    saveEnvironment(makeEnv('dev'));
    saveEnvironment(makeEnv('staging', []));

    const result = promoteEnvironment('dev', 'staging', { keys: ['API_URL'] });
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toBe('API_URL');
  });

  it('creates target env if it does not exist', () => {
    saveEnvironment(makeEnv('dev'));
    promoteEnvironment('dev', 'new-env');

    const env = loadEnvironment('new-env');
    expect(env).toBeDefined();
    expect(env!.variables).toHaveLength(2);
  });

  it('formats environment with secret masking', () => {
    saveEnvironment(makeEnv('dev'));
    const env = loadEnvironment('dev')!;
    const output = formatEnvironment(env);

    expect(output).toContain('dev');
    expect(output).toContain('API_URL=http://localhost:3000');
    expect(output).toContain('********');
    expect(output).not.toContain('secret123');
  });
});
