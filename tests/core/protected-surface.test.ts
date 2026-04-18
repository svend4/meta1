import { describe, it, expect } from 'vitest';
import { DEFAULT_PROTECTED_SURFACE, type ProtectedSurface } from '../../src/types/protected-surface.js';

describe('DEFAULT_PROTECTED_SURFACE', () => {
  it('has empty protected_paths by default', () => {
    expect(DEFAULT_PROTECTED_SURFACE.protected_paths).toEqual([]);
  });

  it('marks node_modules as driftable', () => {
    expect(DEFAULT_PROTECTED_SURFACE.driftable_paths).toContain('node_modules/**');
  });

  it('marks lockfiles as driftable', () => {
    expect(DEFAULT_PROTECTED_SURFACE.driftable_paths).toContain('package-lock.json');
    expect(DEFAULT_PROTECTED_SURFACE.driftable_paths).toContain('pnpm-lock.yaml');
    expect(DEFAULT_PROTECTED_SURFACE.driftable_paths).toContain('yarn.lock');
  });

  it('marks build outputs as driftable', () => {
    expect(DEFAULT_PROTECTED_SURFACE.driftable_paths).toContain('build/**');
    expect(DEFAULT_PROTECTED_SURFACE.driftable_paths).toContain('dist/**');
  });

  it('marks .npm cache as driftable', () => {
    expect(DEFAULT_PROTECTED_SURFACE.driftable_paths).toContain('.npm/**');
  });

  it('conforms to ProtectedSurface interface', () => {
    const surface: ProtectedSurface = DEFAULT_PROTECTED_SURFACE;
    expect(Array.isArray(surface.protected_paths)).toBe(true);
    expect(Array.isArray(surface.driftable_paths)).toBe(true);
  });
});

describe('ProtectedSurface custom configurations', () => {
  it('can define custom protected paths', () => {
    const custom: ProtectedSurface = {
      protected_paths: ['src/**', 'config.json', 'README.md'],
      driftable_paths: ['node_modules/**'],
    };

    expect(custom.protected_paths).toHaveLength(3);
    expect(custom.driftable_paths).toHaveLength(1);
  });

  it('can have overlapping patterns (protected takes precedence in drift detector)', () => {
    const surface: ProtectedSurface = {
      protected_paths: ['src/index.ts'],
      driftable_paths: ['src/**'],
    };

    // Both are valid — resolution happens in drift-detector.ts
    expect(surface.protected_paths).toContain('src/index.ts');
    expect(surface.driftable_paths).toContain('src/**');
  });
});
