import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createWorkspace,
  completeWorkspace,
  failWorkspace,
  getWorkspace,
  listWorkspaces,
  cleanupWorkspace,
  cleanupStaleWorkspaces,
  defaultIsolationConfig,
  formatWorkspace,
} from '../../src/core/run-isolation.js';
import type { IsolationConfig } from '../../src/core/run-isolation.js';

let tempDir: string;
let workDir: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
}));

describe('run-isolation', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-iso-'));
    workDir = mkdtempSync(join(tmpdir(), 'continuum-work-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it('creates workspace in directory mode', () => {
    const config: IsolationConfig = {
      mode: 'directory',
      baseDir: workDir,
      autoCleanup: false,
    };

    const ws = createWorkspace('run-1', config);
    expect(ws.runId).toBe('run-1');
    expect(ws.status).toBe('active');
    expect(existsSync(ws.workspacePath)).toBe(true);
  });

  it('creates workspace in copy mode', () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'continuum-src-'));
    writeFileSync(join(sourceDir, 'file.txt'), 'hello');
    mkdirSync(join(sourceDir, 'sub'));
    writeFileSync(join(sourceDir, 'sub', 'nested.txt'), 'nested');

    const config: IsolationConfig = {
      mode: 'copy',
      baseDir: workDir,
      sourceDir,
      autoCleanup: false,
      excludePatterns: [],
    };

    const ws = createWorkspace('run-copy', config);
    expect(existsSync(join(ws.workspacePath, 'file.txt'))).toBe(true);
    expect(existsSync(join(ws.workspacePath, 'sub', 'nested.txt'))).toBe(true);

    rmSync(sourceDir, { recursive: true, force: true });
  });

  it('excludes patterns in copy mode', () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'continuum-src-'));
    writeFileSync(join(sourceDir, 'keep.txt'), 'keep');
    mkdirSync(join(sourceDir, 'node_modules'));
    writeFileSync(join(sourceDir, 'node_modules', 'pkg.json'), '{}');

    const config: IsolationConfig = {
      mode: 'copy',
      baseDir: workDir,
      sourceDir,
      autoCleanup: false,
      excludePatterns: ['node_modules'],
    };

    const ws = createWorkspace('run-excl', config);
    expect(existsSync(join(ws.workspacePath, 'keep.txt'))).toBe(true);
    expect(existsSync(join(ws.workspacePath, 'node_modules'))).toBe(false);

    rmSync(sourceDir, { recursive: true, force: true });
  });

  it('completes workspace and collects artifacts', () => {
    const config: IsolationConfig = {
      mode: 'directory',
      baseDir: workDir,
      autoCleanup: false,
      collectArtifacts: ['output.json'],
    };

    const ws = createWorkspace('run-art', config);
    writeFileSync(join(ws.workspacePath, 'output.json'), '{"result": true}');

    const completed = completeWorkspace('run-art', config);
    expect(completed).toBeDefined();
    expect(completed!.status).toBe('completed');
    expect(completed!.artifacts).toHaveLength(1);
    expect(completed!.artifacts[0].name).toBe('output.json');
  });

  it('fails workspace', () => {
    const config: IsolationConfig = { mode: 'directory', baseDir: workDir, autoCleanup: false };

    createWorkspace('run-fail', config);
    const failed = failWorkspace('run-fail', config);
    expect(failed!.status).toBe('failed');
  });

  it('auto-cleans on complete', () => {
    const config: IsolationConfig = { mode: 'directory', baseDir: workDir, autoCleanup: true };

    const ws = createWorkspace('run-clean', config);
    const path = ws.workspacePath;

    completeWorkspace('run-clean', config);
    expect(existsSync(path)).toBe(false);
  });

  it('gets workspace by run ID', () => {
    const config: IsolationConfig = { mode: 'directory', baseDir: workDir, autoCleanup: false };
    createWorkspace('run-get', config);

    const ws = getWorkspace('run-get');
    expect(ws).toBeDefined();
    expect(ws!.runId).toBe('run-get');
  });

  it('returns null for unknown workspace', () => {
    expect(getWorkspace('ghost')).toBeNull();
  });

  it('lists workspaces', () => {
    const config: IsolationConfig = { mode: 'directory', baseDir: workDir, autoCleanup: false };
    createWorkspace('run-a', config);
    createWorkspace('run-b', config);

    expect(listWorkspaces()).toHaveLength(2);
  });

  it('lists workspaces by status', () => {
    const config: IsolationConfig = { mode: 'directory', baseDir: workDir, autoCleanup: false };
    createWorkspace('run-a', config);
    createWorkspace('run-b', config);
    completeWorkspace('run-a', config);

    expect(listWorkspaces({ status: 'completed' })).toHaveLength(1);
    expect(listWorkspaces({ status: 'active' })).toHaveLength(1);
  });

  it('cleans up stale workspaces', () => {
    const config: IsolationConfig = { mode: 'directory', baseDir: workDir, autoCleanup: false };
    createWorkspace('run-stale', config);

    // Set createdAt to past
    const cleaned = cleanupStaleWorkspaces(0);
    expect(cleaned).toBe(1);
  });

  it('returns null for complete/fail on unknown', () => {
    const config: IsolationConfig = { mode: 'directory', baseDir: workDir, autoCleanup: false };
    expect(completeWorkspace('ghost', config)).toBeNull();
    expect(failWorkspace('ghost', config)).toBeNull();
  });

  it('default config', () => {
    const config = defaultIsolationConfig();
    expect(config.mode).toBe('directory');
    expect(config.autoCleanup).toBe(true);
  });

  it('formats workspace', () => {
    const config: IsolationConfig = { mode: 'directory', baseDir: workDir, autoCleanup: false };
    const ws = createWorkspace('run-fmt', config);

    const output = formatWorkspace(ws);
    expect(output).toContain('run-fmt');
    expect(output).toContain('ACTIVE');
  });
});
