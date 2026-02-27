import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadConfig,
  loadConfigFile,
  findConfigFile,
  resolveConfig,
  DEFAULT_CONFIG,
  type ContinuumConfig,
} from '../../src/core/config.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-config-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('config', () => {
  describe('findConfigFile', () => {
    it('finds .continuumrc.json in given directory', () => {
      writeFileSync(join(tempDir, '.continuumrc.json'), '{}', 'utf8');
      expect(findConfigFile(tempDir)).toBe(join(tempDir, '.continuumrc.json'));
    });

    it('returns null when no config file exists', () => {
      expect(findConfigFile(tempDir)).toBeNull();
    });

    it('walks up to find config in parent directory', () => {
      const child = join(tempDir, 'subdir');
      mkdirSync(child);
      writeFileSync(join(tempDir, '.continuumrc.json'), '{}', 'utf8');
      expect(findConfigFile(child)).toBe(join(tempDir, '.continuumrc.json'));
    });
  });

  describe('loadConfigFile', () => {
    it('loads valid config file', () => {
      const config: ContinuumConfig = { model: 'test-model' };
      writeFileSync(join(tempDir, '.continuumrc.json'), JSON.stringify(config), 'utf8');
      const loaded = loadConfigFile(join(tempDir, '.continuumrc.json'));
      expect(loaded.model).toBe('test-model');
    });

    it('throws on explicit nonexistent path', () => {
      expect(() => loadConfigFile(join(tempDir, 'nonexistent.json'))).toThrow(/Failed to load config/);
    });

    it('throws on explicit invalid path', () => {
      writeFileSync(join(tempDir, 'bad.json'), 'not json', 'utf8');
      expect(() => loadConfigFile(join(tempDir, 'bad.json'))).toThrow(/Failed to load config/);
    });
  });

  describe('resolveConfig', () => {
    it('returns defaults when config is empty', () => {
      const resolved = resolveConfig({});
      expect(resolved.model).toBe(DEFAULT_CONFIG.model);
      expect(resolved.sandbox).toBe('local');
      expect(resolved.repair.enabled_levels).toEqual([1, 2, 3]);
      expect(resolved.retention.max_runs).toBe(100);
    });

    it('file config overrides defaults', () => {
      const resolved = resolveConfig({ model: 'custom-model', retention: { max_runs: 50 } });
      expect(resolved.model).toBe('custom-model');
      expect(resolved.retention.max_runs).toBe(50);
      expect(resolved.retention.max_age_days).toBe(DEFAULT_CONFIG.retention.max_age_days);
    });

    it('CLI overrides override file config', () => {
      const resolved = resolveConfig(
        { model: 'file-model' },
        { model: 'cli-model' },
      );
      expect(resolved.model).toBe('cli-model');
    });

    it('deep merges nested objects', () => {
      const resolved = resolveConfig(
        { repair: { timeout_ms: 5000 } },
        { repair: { max_tokens: 1000 } },
      );
      expect(resolved.repair.timeout_ms).toBe(5000);
      expect(resolved.repair.max_tokens).toBe(1000);
    });
  });

  describe('loadConfig', () => {
    it('loads config from directory with file', () => {
      writeFileSync(join(tempDir, '.continuumrc.json'), JSON.stringify({
        model: 'test',
        sandbox: 'docker',
      }), 'utf8');
      const resolved = loadConfig(join(tempDir, '.continuumrc.json'));
      expect(resolved.model).toBe('test');
      expect(resolved.sandbox).toBe('docker');
    });

    it('returns defaults when no config', () => {
      const resolved = loadConfig(undefined);
      expect(resolved.model).toBe(DEFAULT_CONFIG.model);
    });
  });
});
