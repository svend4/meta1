import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  getBaseDir,
  getRunsDir,
  getRunDir,
  getEventsPath,
  getSummaryPath,
  getPlanCacheDir,
  getCachedPlanPath,
  getDefaultWorkspace,
  getGenerationsDir,
  getGenerationDir,
  getFreezeDir,
  getRepairsDir,
  getRepairDir,
  getForensicsDir,
  getHttpForensicsDir,
} from '../../src/core/paths.js';

const HOME = homedir();
const BASE = join(HOME, '.continuum');

describe('paths module', () => {
  describe('getBaseDir', () => {
    it('returns ~/.continuum', () => {
      expect(getBaseDir()).toBe(BASE);
    });
  });

  describe('getRunsDir', () => {
    it('returns ~/.continuum/runs', () => {
      expect(getRunsDir()).toBe(join(BASE, 'runs'));
    });
  });

  describe('getRunDir', () => {
    it('returns ~/.continuum/runs/<run_id>', () => {
      expect(getRunDir('abc-123')).toBe(join(BASE, 'runs', 'abc-123'));
    });
  });

  describe('getEventsPath', () => {
    it('returns correct events.jsonl path', () => {
      expect(getEventsPath('run-1')).toBe(join(BASE, 'runs', 'run-1', 'events.jsonl'));
    });
  });

  describe('getSummaryPath', () => {
    it('returns correct summary.json path', () => {
      expect(getSummaryPath('run-1')).toBe(join(BASE, 'runs', 'run-1', 'summary.json'));
    });
  });

  describe('getPlanCacheDir', () => {
    it('returns ~/.continuum/cache/plans', () => {
      expect(getPlanCacheDir()).toBe(join(BASE, 'cache', 'plans'));
    });
  });

  describe('getCachedPlanPath', () => {
    it('strips sha256: prefix for filename', () => {
      const key = 'sha256:abc123def456';
      expect(getCachedPlanPath(key)).toBe(join(BASE, 'cache', 'plans', 'abc123def456.json'));
    });

    it('handles raw hex key', () => {
      expect(getCachedPlanPath('deadbeef')).toBe(join(BASE, 'cache', 'plans', 'deadbeef.json'));
    });
  });

  describe('getDefaultWorkspace', () => {
    it('returns ~/.continuum/workspaces/<run_id>', () => {
      expect(getDefaultWorkspace('run-42')).toBe(join(BASE, 'workspaces', 'run-42'));
    });
  });

  describe('v3.0 paths', () => {
    it('getGenerationsDir returns correct path', () => {
      expect(getGenerationsDir()).toBe(join(BASE, 'generations'));
    });

    it('getGenerationDir strips sha256: prefix', () => {
      expect(getGenerationDir('sha256:abc123')).toBe(join(BASE, 'generations', 'abc123'));
    });

    it('getFreezeDir returns correct path', () => {
      expect(getFreezeDir()).toBe(join(BASE, 'freeze'));
    });

    it('getRepairsDir returns correct path', () => {
      expect(getRepairsDir()).toBe(join(BASE, 'repairs'));
    });

    it('getRepairDir returns correct path', () => {
      expect(getRepairDir('repair-1')).toBe(join(BASE, 'repairs', 'repair-1'));
    });

    it('getForensicsDir returns correct path', () => {
      expect(getForensicsDir('run-1')).toBe(join(BASE, 'runs', 'run-1', 'forensics'));
    });

    it('getHttpForensicsDir returns correct path', () => {
      expect(getHttpForensicsDir('run-1', 'step-1')).toBe(
        join(BASE, 'runs', 'run-1', 'forensics', 'http', 'step-1'),
      );
    });
  });

  describe('path consistency', () => {
    it('events path is inside run dir', () => {
      const runDir = getRunDir('test');
      const eventsPath = getEventsPath('test');
      expect(eventsPath.startsWith(runDir)).toBe(true);
    });

    it('summary path is inside run dir', () => {
      const runDir = getRunDir('test');
      const summaryPath = getSummaryPath('test');
      expect(summaryPath.startsWith(runDir)).toBe(true);
    });

    it('forensics path is inside run dir', () => {
      const runDir = getRunDir('test');
      const forensicsDir = getForensicsDir('test');
      expect(forensicsDir.startsWith(runDir)).toBe(true);
    });

    it('generation dir is inside generations dir', () => {
      const genDir = getGenerationsDir();
      const specificDir = getGenerationDir('sha256:abc');
      expect(specificDir.startsWith(genDir)).toBe(true);
    });
  });
});
