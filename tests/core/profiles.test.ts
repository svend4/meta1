import { describe, it, expect } from 'vitest';
import { resolveConfig, listProfiles, loadConfig } from '../../src/core/config.js';
import type { ContinuumConfig } from '../../src/core/config.js';

describe('environment profiles', () => {
  const baseConfig: ContinuumConfig = {
    model: 'claude-sonnet-4-20250514',
    sandbox: 'local',
    execution: { max_concurrency: 4 },
    repair: { enabled_levels: [1, 2, 3], timeout_ms: 30000 },
    profiles: {
      production: {
        sandbox: 'docker',
        execution: { max_concurrency: 1 },
        repair: { enabled_levels: [1, 2] },
      },
      staging: {
        model: 'test-model',
        execution: { max_concurrency: 2 },
      },
    },
  };

  it('lists available profiles', () => {
    const profiles = listProfiles(baseConfig);
    expect(profiles).toContain('production');
    expect(profiles).toContain('staging');
    expect(profiles).toHaveLength(2);
  });

  it('returns empty list when no profiles defined', () => {
    expect(listProfiles({})).toEqual([]);
  });

  it('resolves without profile (base config)', () => {
    const resolved = resolveConfig(baseConfig);
    expect(resolved.sandbox).toBe('local');
    expect(resolved.execution.max_concurrency).toBe(4);
  });

  it('applies production profile', () => {
    const resolved = resolveConfig(baseConfig, undefined, 'production');
    expect(resolved.sandbox).toBe('docker');
    expect(resolved.execution.max_concurrency).toBe(1);
    expect(resolved.repair.enabled_levels).toEqual([1, 2]);
    // Base model should still be present (not overridden by production)
    expect(resolved.model).toBe('claude-sonnet-4-20250514');
  });

  it('applies staging profile', () => {
    const resolved = resolveConfig(baseConfig, undefined, 'staging');
    expect(resolved.model).toBe('test-model');
    expect(resolved.execution.max_concurrency).toBe(2);
    // Sandbox should remain from base
    expect(resolved.sandbox).toBe('local');
  });

  it('CLI overrides take precedence over profile', () => {
    const resolved = resolveConfig(baseConfig, { sandbox: 'local' }, 'production');
    // Profile sets docker, CLI overrides to local
    expect(resolved.sandbox).toBe('local');
  });

  it('throws for unknown profile', () => {
    expect(() => resolveConfig(baseConfig, undefined, 'nonexistent')).toThrow(
      'Unknown profile "nonexistent"',
    );
  });

  it('error message lists available profiles', () => {
    expect(() => resolveConfig(baseConfig, undefined, 'bad')).toThrow(
      'production, staging',
    );
  });
});
