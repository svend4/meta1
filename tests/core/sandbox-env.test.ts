import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalSandbox } from '../../src/sandbox/local.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('LocalSandbox environment variables', () => {
  let workspace: string;
  let sandbox: LocalSandbox;

  beforeEach(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'env-test-'));
    sandbox = new LocalSandbox(workspace);
    await sandbox.init();
  });

  afterEach(() => {
    try { rmSync(workspace, { recursive: true }); } catch { /* ok */ }
  });

  it('passes environment variables to commands', async () => {
    const result = await sandbox.exec('sh', ['-c', 'echo $MY_VAR'], {
      env: { MY_VAR: 'hello-world' },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello-world');
  });

  it('merges env vars with process env', async () => {
    const result = await sandbox.exec('sh', ['-c', 'echo $PATH'], {
      env: { CUSTOM: 'val' },
    });

    // PATH should still be present from process.env
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  it('works without env options', async () => {
    const result = await sandbox.exec('echo', ['no-env']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('no-env');
  });

  it('env vars override process env', async () => {
    const result = await sandbox.exec('sh', ['-c', 'echo $HOME'], {
      env: { HOME: '/custom/home' },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('/custom/home');
  });
});
