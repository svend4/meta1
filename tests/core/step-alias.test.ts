import { describe, it, expect } from 'vitest';
import { buildAliasMap, resolveAliases, resolveStepRef, listAliases } from '../../src/core/step-alias.js';
import type { ExecutionPlan, Step } from '../../src/types/execution-plan.js';

function makeSteps(): Step[] {
  return [
    { step_id: 'step-install-deps-1', type: 'run_command', description: 'Install deps', command: 'npm', args: ['install'], determinism: 'best_effort', alias: 'install' } as Step & { alias: string },
    { step_id: 'step-create-config-2', type: 'create_file', description: 'Create config', path: 'config.json', content: '{}', determinism: 'guaranteed', alias: 'config' } as Step & { alias: string },
    { step_id: 'step-build-3', type: 'run_command', description: 'Build', command: 'npm', args: ['build'], determinism: 'best_effort', depends_on: ['install', 'config'] } as Step,
  ] as Step[];
}

describe('buildAliasMap', () => {
  it('builds map from steps with aliases', () => {
    const map = buildAliasMap(makeSteps());
    expect(map.get('install')).toBe('step-install-deps-1');
    expect(map.get('config')).toBe('step-create-config-2');
    expect(map.size).toBe(2);
  });

  it('returns empty map when no aliases', () => {
    const steps = [
      { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
    ] as Step[];
    expect(buildAliasMap(steps).size).toBe(0);
  });

  it('throws on duplicate aliases', () => {
    const steps = [
      { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed', alias: 'dup' },
      { step_id: 's2', type: 'create_file', description: '', path: 'b', content: '', determinism: 'guaranteed', alias: 'dup' },
    ] as (Step & { alias: string })[];
    expect(() => buildAliasMap(steps)).toThrow('Duplicate alias');
  });

  it('throws when alias collides with step_id', () => {
    const steps = [
      { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed', alias: 's2' },
      { step_id: 's2', type: 'create_file', description: '', path: 'b', content: '', determinism: 'guaranteed' },
    ] as (Step & { alias?: string })[];
    expect(() => buildAliasMap(steps)).toThrow('collides');
  });
});

describe('resolveAliases', () => {
  it('resolves alias references in depends_on', () => {
    const plan = { plan_id: 'test', steps: makeSteps() } as ExecutionPlan;
    const resolved = resolveAliases(plan);
    const buildStep = resolved.steps[2];
    expect(buildStep.depends_on).toEqual(['step-install-deps-1', 'step-create-config-2']);
  });

  it('returns plan unchanged when no aliases', () => {
    const plan = {
      plan_id: 'test',
      steps: [
        { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
      ],
    } as ExecutionPlan;
    const resolved = resolveAliases(plan);
    expect(resolved).toBe(plan); // Same reference (no copy needed)
  });

  it('preserves direct step_id references', () => {
    const steps = [
      { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed', alias: 'setup' },
      { step_id: 's2', type: 'run_command', description: '', command: 'echo', args: [], determinism: 'best_effort', depends_on: ['s1'] },
    ] as (Step & { alias?: string })[];
    const plan = { plan_id: 'test', steps } as ExecutionPlan;
    const resolved = resolveAliases(plan);
    expect(resolved.steps[1].depends_on).toEqual(['s1']); // s1 isn't an alias, stays as-is
  });
});

describe('resolveStepRef', () => {
  it('resolves by step_id', () => {
    const steps = makeSteps();
    const step = resolveStepRef('step-install-deps-1', steps);
    expect(step?.step_id).toBe('step-install-deps-1');
  });

  it('resolves by alias', () => {
    const steps = makeSteps();
    const step = resolveStepRef('install', steps);
    expect(step?.step_id).toBe('step-install-deps-1');
  });

  it('returns undefined for unknown ref', () => {
    expect(resolveStepRef('ghost', makeSteps())).toBeUndefined();
  });
});

describe('listAliases', () => {
  it('lists all aliases', () => {
    const aliases = listAliases(makeSteps());
    expect(aliases).toHaveLength(2);
    expect(aliases[0].alias).toBe('install');
    expect(aliases[0].stepId).toBe('step-install-deps-1');
    expect(aliases[1].alias).toBe('config');
  });

  it('returns empty for no aliases', () => {
    const steps = [
      { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
    ] as Step[];
    expect(listAliases(steps)).toHaveLength(0);
  });
});
