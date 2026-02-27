import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  checkPlanStructure,
  checkDependencies,
  checkAssertionTargets,
  checkApiKey,
  checkWorkspace,
  runPreflight,
} from '../../src/core/preflight.js';
import type { ExecutionPlan, ExecutionPlanV3 } from '../../src/types/execution-plan.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-preflight-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makePlan(steps: ExecutionPlan['steps']): ExecutionPlan {
  return { plan_id: randomUUID(), steps };
}

describe('preflight checks', () => {
  describe('checkPlanStructure', () => {
    it('passes for valid plan', () => {
      const result = checkPlanStructure(makePlan([{
        step_id: 's1',
        type: 'create_file',
        description: 'Test',
        path: '/tmp/x',
        content: 'hi',
        determinism: 'guaranteed',
      }]));
      expect(result.status).toBe('pass');
    });

    it('fails for invalid plan', () => {
      const result = checkPlanStructure({ bad: true });
      expect(result.status).toBe('fail');
    });
  });

  describe('checkDependencies', () => {
    it('passes for valid dependencies', () => {
      const plan = makePlan([
        { step_id: 'a', type: 'create_file', description: 'A', path: '/a', content: '', determinism: 'guaranteed' },
        { step_id: 'b', type: 'create_file', description: 'B', path: '/b', content: '', determinism: 'guaranteed', depends_on: ['a'] },
      ]);
      expect(checkDependencies(plan).status).toBe('pass');
    });

    it('fails for cyclic dependencies', () => {
      const plan = makePlan([
        { step_id: 'a', type: 'create_file', description: 'A', path: '/a', content: '', determinism: 'guaranteed', depends_on: ['b'] },
        { step_id: 'b', type: 'create_file', description: 'B', path: '/b', content: '', determinism: 'guaranteed', depends_on: ['a'] },
      ]);
      expect(checkDependencies(plan).status).toBe('fail');
    });
  });

  describe('checkAssertionTargets', () => {
    it('skips for non-v3 plan', () => {
      const result = checkAssertionTargets(makePlan([]));
      expect(result.status).toBe('skip');
    });

    it('passes for v3 plan with valid assertions', () => {
      const plan: ExecutionPlanV3 = {
        plan_id: randomUUID(),
        version: '3.0',
        steps: [{ step_id: 's1', type: 'create_file', description: 'X', path: '/x', content: '', determinism: 'guaranteed' }],
        assertions: [{
          assertion_id: 'a1',
          type: 'file_exists',
          description: 'Check',
          spec: { path: '/x' },
          required: true,
          stability: 'stable',
        }],
      };
      expect(checkAssertionTargets(plan).status).toBe('pass');
    });
  });

  describe('checkApiKey', () => {
    it('passes when env var is set', () => {
      const key = `TEST_KEY_${randomUUID()}`;
      process.env[key] = 'test-value';
      try {
        expect(checkApiKey(key).status).toBe('pass');
      } finally {
        delete process.env[key];
      }
    });

    it('warns when env var is not set', () => {
      expect(checkApiKey('NONEXISTENT_VAR_12345').status).toBe('warn');
    });
  });

  describe('checkWorkspace', () => {
    it('passes for writable directory', () => {
      expect(checkWorkspace(tempDir).status).toBe('pass');
    });

    it('creates non-existent directory', () => {
      const newDir = join(tempDir, 'new-workspace');
      expect(checkWorkspace(newDir).status).toBe('pass');
    });
  });

  describe('runPreflight', () => {
    it('runs all applicable checks', () => {
      const plan = makePlan([{
        step_id: 's1',
        type: 'create_file',
        description: 'Test',
        path: '/tmp/x',
        content: 'hi',
        determinism: 'guaranteed',
      }]);

      const report = runPreflight({
        plan,
        workspace: tempDir,
        apiKeyEnv: 'NONEXISTENT_KEY_PREFLIGHT',
      });

      expect(report.checks.length).toBeGreaterThanOrEqual(3);
      expect(report.checks.some((c) => c.check === 'plan_structure')).toBe(true);
      expect(report.checks.some((c) => c.check === 'workspace')).toBe(true);
    });

    it('marks valid when no failures', () => {
      const report = runPreflight({ workspace: tempDir });
      expect(report.valid).toBe(true);
    });

    it('marks invalid when plan is bad', () => {
      const report = runPreflight({ plan: { invalid: true } });
      expect(report.valid).toBe(false);
    });
  });
});
