import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalSandbox } from '../../src/sandbox/local.js';

let tempDir: string;
let workspace: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-sandbox-test-'));
  workspace = join(tempDir, 'workspace');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('LocalSandbox', () => {
  it('init creates the workspace directory', async () => {
    const sandbox = new LocalSandbox(workspace);
    await sandbox.init();
    expect(existsSync(workspace)).toBe(true);
  });

  it('writeFile creates a file with given content', async () => {
    const sandbox = new LocalSandbox(workspace);
    await sandbox.init();
    await sandbox.writeFile('hello.txt', 'hello world');

    const content = readFileSync(join(workspace, 'hello.txt'), 'utf8');
    expect(content).toBe('hello world');
  });

  it('writeFile creates nested directories as needed', async () => {
    const sandbox = new LocalSandbox(workspace);
    await sandbox.init();
    await sandbox.writeFile('src/lib/utils.ts', 'export const x = 1;');

    const content = readFileSync(join(workspace, 'src/lib/utils.ts'), 'utf8');
    expect(content).toBe('export const x = 1;');
  });

  it('readFile reads back written content', async () => {
    const sandbox = new LocalSandbox(workspace);
    await sandbox.init();
    await sandbox.writeFile('data.json', '{"key": "value"}');

    const content = await sandbox.readFile('data.json');
    expect(content).toBe('{"key": "value"}');
  });

  it('exec runs a command and captures stdout', async () => {
    const sandbox = new LocalSandbox(workspace);
    await sandbox.init();

    const result = await sandbox.exec('node', ['-e', 'console.log("output")']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('output');
  });

  it('exec returns non-zero exit code on failure', async () => {
    const sandbox = new LocalSandbox(workspace);
    await sandbox.init();

    const result = await sandbox.exec('node', ['-e', 'process.exit(42)']);
    expect(result.exitCode).toBe(42);
  });

  it('exec captures stderr on failure', async () => {
    const sandbox = new LocalSandbox(workspace);
    await sandbox.init();

    const result = await sandbox.exec('node', [
      '-e',
      'console.error("err msg"); process.exit(1)',
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('err msg');
  });

  it('exec runs in workspace directory', async () => {
    const sandbox = new LocalSandbox(workspace);
    await sandbox.init();
    await sandbox.writeFile('marker.txt', 'found');

    const result = await sandbox.exec('node', [
      '-e',
      'const fs = require("fs"); console.log(fs.readFileSync("marker.txt", "utf8"))',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('found');
  });

  it('getWorkspacePath returns the workspace path', () => {
    const sandbox = new LocalSandbox(workspace);
    expect(sandbox.getWorkspacePath()).toBe(workspace);
  });

  it('destroy is a no-op (workspace persists)', async () => {
    const sandbox = new LocalSandbox(workspace);
    await sandbox.init();
    await sandbox.writeFile('keep.txt', 'persist');
    await sandbox.destroy();

    // File should still exist after destroy
    expect(existsSync(join(workspace, 'keep.txt'))).toBe(true);
  });
});
