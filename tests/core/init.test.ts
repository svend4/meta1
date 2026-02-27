import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initProject, generateDefaultConfig } from '../../src/core/init.js';

describe('initProject', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-init-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates .continuumrc.json and plans/ directory', () => {
    const result = initProject({ dir: tempDir });

    expect(result.created).toContain('.continuumrc.json');
    expect(result.created).toContain('plans/');
    expect(result.skipped).toHaveLength(0);
    expect(existsSync(join(tempDir, '.continuumrc.json'))).toBe(true);
    expect(existsSync(join(tempDir, 'plans'))).toBe(true);
  });

  it('skips existing files without --force', () => {
    initProject({ dir: tempDir });
    const result = initProject({ dir: tempDir });

    expect(result.skipped).toContain('.continuumrc.json');
    expect(result.skipped).toContain('plans/');
    expect(result.created).toHaveLength(0);
  });

  it('overwrites with --force', () => {
    initProject({ dir: tempDir });
    const result = initProject({ dir: tempDir, force: true });

    expect(result.created).toContain('.continuumrc.json');
    // plans/ already exists from first init, so it's skipped
    expect(result.skipped).toContain('plans/');
  });

  it('creates example plan with --withExample', () => {
    const result = initProject({ dir: tempDir, withExample: true });

    expect(result.created).toContain('plans/example.json');
    const example = JSON.parse(readFileSync(join(tempDir, 'plans', 'example.json'), 'utf8'));
    expect(example.plan_id).toBe('example-plan');
    expect(example.steps.length).toBeGreaterThan(0);
  });

  it('configures docker sandbox', () => {
    initProject({ dir: tempDir, sandbox: 'docker' });
    const config = JSON.parse(readFileSync(join(tempDir, '.continuumrc.json'), 'utf8'));

    expect(config.sandbox).toBe('docker');
    expect(config.docker_image).toBe('node:20-slim');
  });

  it('creates directory if it does not exist', () => {
    const nested = join(tempDir, 'sub', 'dir');
    const result = initProject({ dir: nested });

    expect(existsSync(nested)).toBe(true);
    expect(result.created).toContain('.continuumrc.json');
  });

  it('produces valid JSON config', () => {
    initProject({ dir: tempDir });
    const raw = readFileSync(join(tempDir, '.continuumrc.json'), 'utf8');
    const config = JSON.parse(raw);

    expect(config.sandbox).toBe('local');
    expect(config.cache).toBeDefined();
    expect(config.execution).toBeDefined();
    expect(config.retention).toBeDefined();
  });
});

describe('generateDefaultConfig', () => {
  it('returns local sandbox by default', () => {
    const config = generateDefaultConfig();
    expect(config.sandbox).toBe('local');
    expect(config.docker_image).toBeUndefined();
  });

  it('returns docker sandbox with image', () => {
    const config = generateDefaultConfig({ sandbox: 'docker' });
    expect(config.sandbox).toBe('docker');
    expect(config.docker_image).toBe('node:20-slim');
  });
});
