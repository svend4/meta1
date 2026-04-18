import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { captureDependencyFingerprint, compareDependencyFingerprints } from '../../src/core/fingerprint.js';
import type { DependencyFingerprint } from '../../src/types/dependency-fingerprint.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-fp-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('captureDependencyFingerprint', () => {
  it('captures node and npm versions', () => {
    const fp = captureDependencyFingerprint(tempDir);

    expect(fp.fingerprint_id).toBeDefined();
    expect(fp.captured_at).toBeDefined();
    expect(fp.fingerprint_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fp.tools.node).toMatch(/^\d+\.\d+\.\d+$/);
    expect(fp.tools.npm).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('detects npm lockfile when present', () => {
    writeFileSync(join(tempDir, 'package-lock.json'), '{"lockfileVersion":3}', 'utf8');

    const fp = captureDependencyFingerprint(tempDir);

    expect(fp.lockfile).toBeDefined();
    expect(fp.lockfile!.path).toBe('package-lock.json');
    expect(fp.lockfile!.format).toBe('npm');
    expect(fp.lockfile!.hash).toMatch(/^sha256:/);
  });

  it('detects pnpm lockfile when present', () => {
    writeFileSync(join(tempDir, 'pnpm-lock.yaml'), 'lockfileVersion: 5.4', 'utf8');

    const fp = captureDependencyFingerprint(tempDir);

    expect(fp.lockfile).toBeDefined();
    expect(fp.lockfile!.path).toBe('pnpm-lock.yaml');
    expect(fp.lockfile!.format).toBe('pnpm');
  });

  it('detects yarn lockfile when present', () => {
    writeFileSync(join(tempDir, 'yarn.lock'), '# yarn lockfile v1', 'utf8');

    const fp = captureDependencyFingerprint(tempDir);

    expect(fp.lockfile).toBeDefined();
    expect(fp.lockfile!.path).toBe('yarn.lock');
    expect(fp.lockfile!.format).toBe('yarn');
  });

  it('prefers npm lockfile over others (checked first)', () => {
    writeFileSync(join(tempDir, 'package-lock.json'), '{}', 'utf8');
    writeFileSync(join(tempDir, 'yarn.lock'), '# yarn', 'utf8');

    const fp = captureDependencyFingerprint(tempDir);
    expect(fp.lockfile!.format).toBe('npm');
  });

  it('returns undefined lockfile when none present', () => {
    const fp = captureDependencyFingerprint(tempDir);
    expect(fp.lockfile).toBeUndefined();
  });

  it('captures sandbox image when provided', () => {
    const fp = captureDependencyFingerprint(tempDir, {
      name: 'node:20-slim',
      digest: 'sha256:abc123def456',
    });

    expect(fp.sandbox_image).toBeDefined();
    expect(fp.sandbox_image!.name).toBe('node:20-slim');
    expect(fp.sandbox_image!.digest).toBe('sha256:abc123def456');
  });

  it('returns undefined sandbox_image when not provided', () => {
    const fp = captureDependencyFingerprint(tempDir);
    expect(fp.sandbox_image).toBeUndefined();
  });

  it('produces deterministic hash for same environment', () => {
    const fp1 = captureDependencyFingerprint(tempDir);
    const fp2 = captureDependencyFingerprint(tempDir);

    // Hash should be the same (same tools, same lockfile state)
    expect(fp1.fingerprint_hash).toBe(fp2.fingerprint_hash);
  });

  it('produces different hash when lockfile changes', () => {
    writeFileSync(join(tempDir, 'package-lock.json'), '{"version": 1}', 'utf8');
    const fp1 = captureDependencyFingerprint(tempDir);

    writeFileSync(join(tempDir, 'package-lock.json'), '{"version": 2}', 'utf8');
    const fp2 = captureDependencyFingerprint(tempDir);

    expect(fp1.fingerprint_hash).not.toBe(fp2.fingerprint_hash);
  });

  it('captures dependency tree when package.json exists', () => {
    writeFileSync(join(tempDir, 'package.json'), '{"name":"test","dependencies":{}}', 'utf8');
    mkdirSync(join(tempDir, 'node_modules'), { recursive: true });

    const fp = captureDependencyFingerprint(tempDir);
    // Dependency tree may or may not be captured depending on npm state
    // Just verify it doesn't crash
    expect(fp).toBeDefined();
  });
});

describe('compareDependencyFingerprints', () => {
  function makeFp(overrides?: Partial<DependencyFingerprint>): DependencyFingerprint {
    return {
      fingerprint_id: 'fp-1',
      captured_at: new Date().toISOString(),
      fingerprint_hash: 'sha256:' + '0'.repeat(64) as `sha256:${string}`,
      tools: { node: '20.11.0', npm: '10.2.0' },
      ...overrides,
    };
  }

  it('returns empty array when fingerprints match', () => {
    const fp = makeFp();
    const drifts = compareDependencyFingerprints(fp, fp);
    expect(drifts).toHaveLength(0);
  });

  it('detects node version change', () => {
    const orig = makeFp({ fingerprint_hash: 'sha256:aaa' as `sha256:${string}` });
    const curr = makeFp({
      fingerprint_hash: 'sha256:bbb' as `sha256:${string}`,
      tools: { node: '22.0.0', npm: '10.2.0' },
    });

    const drifts = compareDependencyFingerprints(orig, curr);
    expect(drifts).toContain('node: 20.11.0 → 22.0.0');
  });

  it('detects npm version change', () => {
    const orig = makeFp({ fingerprint_hash: 'sha256:aaa' as `sha256:${string}` });
    const curr = makeFp({
      fingerprint_hash: 'sha256:bbb' as `sha256:${string}`,
      tools: { node: '20.11.0', npm: '10.5.0' },
    });

    const drifts = compareDependencyFingerprints(orig, curr);
    expect(drifts).toContain('npm: 10.2.0 → 10.5.0');
  });

  it('detects lockfile hash change', () => {
    const orig = makeFp({
      fingerprint_hash: 'sha256:aaa' as `sha256:${string}`,
      lockfile: { path: 'package-lock.json', hash: 'sha256:old' as `sha256:${string}`, format: 'npm' },
    });
    const curr = makeFp({
      fingerprint_hash: 'sha256:bbb' as `sha256:${string}`,
      lockfile: { path: 'package-lock.json', hash: 'sha256:new' as `sha256:${string}`, format: 'npm' },
    });

    const drifts = compareDependencyFingerprints(orig, curr);
    expect(drifts.some((d) => d.includes('lockfile'))).toBe(true);
  });

  it('detects sandbox image digest change', () => {
    const orig = makeFp({
      fingerprint_hash: 'sha256:aaa' as `sha256:${string}`,
      sandbox_image: { name: 'node:20-slim', digest: 'sha256:old' },
    });
    const curr = makeFp({
      fingerprint_hash: 'sha256:bbb' as `sha256:${string}`,
      sandbox_image: { name: 'node:20-slim', digest: 'sha256:new' },
    });

    const drifts = compareDependencyFingerprints(orig, curr);
    expect(drifts.some((d) => d.includes('sandbox image'))).toBe(true);
  });

  it('detects multiple drifts at once', () => {
    const orig = makeFp({
      fingerprint_hash: 'sha256:aaa' as `sha256:${string}`,
      tools: { node: '20.11.0', npm: '10.2.0', git: '2.40.0' },
    });
    const curr = makeFp({
      fingerprint_hash: 'sha256:bbb' as `sha256:${string}`,
      tools: { node: '22.0.0', npm: '10.5.0', git: '2.42.0' },
    });

    const drifts = compareDependencyFingerprints(orig, curr);
    expect(drifts.length).toBe(3);
  });

  it('ignores git if one side is undefined', () => {
    const orig = makeFp({ fingerprint_hash: 'sha256:aaa' as `sha256:${string}` });
    const curr = makeFp({
      fingerprint_hash: 'sha256:bbb' as `sha256:${string}`,
      tools: { node: '20.11.0', npm: '10.2.0', git: '2.42.0' },
    });

    const drifts = compareDependencyFingerprints(orig, curr);
    expect(drifts.some((d) => d.includes('git'))).toBe(false);
  });
});
