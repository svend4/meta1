import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  saveTemplate,
  loadTemplate,
  listTemplates,
  deleteTemplate,
  instantiateTemplate,
  createTemplateFromPlan,
  validateTemplateParams,
  formatTemplate,
} from '../../src/core/template-library.js';
import type { PlanTemplate } from '../../src/core/template-library.js';
import type { ExecutionPlan } from '../../src/types/execution-plan.js';

let tempDir: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
}));

function makeTemplate(overrides?: Partial<PlanTemplate>): PlanTemplate {
  return {
    templateId: 'build-project',
    name: 'Build Project',
    description: 'Build a project with configurable output dir',
    params: [
      { name: 'output_dir', type: 'string', required: true, description: 'Output directory' },
      { name: 'minify', type: 'boolean', required: false, default: 'true' },
    ],
    plan: {
      plan_id: 'template-{{output_dir}}',
      steps: [
        { step_id: 'build', type: 'run_command', description: 'Build to {{output_dir}}', command: 'npm', args: ['build', '--outDir', '{{output_dir}}'], determinism: 'best_effort' },
      ],
    },
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('template-library', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-tpl-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves and loads a template', () => {
    const tpl = makeTemplate();
    saveTemplate(tpl);

    const loaded = loadTemplate('build-project');
    expect(loaded).toBeDefined();
    expect(loaded!.name).toBe('Build Project');
    expect(loaded!.params).toHaveLength(2);
  });

  it('lists templates', () => {
    saveTemplate(makeTemplate({ templateId: 'a', name: 'A' }));
    saveTemplate(makeTemplate({ templateId: 'b', name: 'B' }));

    const list = listTemplates();
    expect(list).toHaveLength(2);
  });

  it('deletes a template', () => {
    saveTemplate(makeTemplate());
    expect(deleteTemplate('build-project')).toBe(true);
    expect(loadTemplate('build-project')).toBeNull();
  });

  it('returns false for deleting nonexistent', () => {
    expect(deleteTemplate('ghost')).toBe(false);
  });

  it('returns null for nonexistent template', () => {
    expect(loadTemplate('ghost')).toBeNull();
  });

  it('instantiates template with params', () => {
    saveTemplate(makeTemplate());

    const result = instantiateTemplate('build-project', { output_dir: 'dist' });
    expect(result.plan.steps[0].description).toBe('Build to dist');
    expect(result.resolvedParams.output_dir).toBe('dist');
    expect(result.resolvedParams.minify).toBe('true'); // default
    expect(result.unresolvedPlaceholders).toHaveLength(0);
  });

  it('reports unresolved placeholders', () => {
    saveTemplate(makeTemplate({
      templateId: 'x',
      params: [],
      plan: { plan_id: '{{foo}}', steps: [] },
    }));

    const result = instantiateTemplate('x', {});
    expect(result.unresolvedPlaceholders).toContain('foo');
  });

  it('throws for missing required param', () => {
    saveTemplate(makeTemplate());
    expect(() => instantiateTemplate('build-project', {})).toThrow('Missing required parameter');
  });

  it('throws for nonexistent template on instantiate', () => {
    expect(() => instantiateTemplate('ghost', {})).toThrow('Template not found');
  });

  it('validates params: missing required', () => {
    const tpl = makeTemplate();
    const issues = validateTemplateParams(tpl, {});
    expect(issues.some((i) => i.includes('output_dir'))).toBe(true);
  });

  it('validates params: invalid number', () => {
    const tpl = makeTemplate({
      params: [{ name: 'count', type: 'number', required: true }],
    });
    const issues = validateTemplateParams(tpl, { count: 'abc' });
    expect(issues.some((i) => i.includes('number'))).toBe(true);
  });

  it('validates params: invalid boolean', () => {
    const tpl = makeTemplate({
      params: [{ name: 'flag', type: 'boolean', required: true }],
    });
    const issues = validateTemplateParams(tpl, { flag: 'yes' });
    expect(issues.some((i) => i.includes('true'))).toBe(true);
  });

  it('validates params: unknown param', () => {
    const tpl = makeTemplate();
    const issues = validateTemplateParams(tpl, { output_dir: 'x', unknown: 'y' });
    expect(issues.some((i) => i.includes('Unknown'))).toBe(true);
  });

  it('creates template from plan', () => {
    const plan: ExecutionPlan = {
      plan_id: 'my-plan',
      steps: [
        { step_id: 's1', type: 'create_file', description: 'Create', path: '/tmp/out/file.txt', content: 'hello', determinism: 'guaranteed' },
      ],
    };

    const tpl = createTemplateFromPlan(plan, 'from-plan', 'From Plan', 'Auto-generated', {
      '/tmp/out': { placeholder: 'output_dir', description: 'Output directory' },
    });

    expect(tpl.params).toHaveLength(1);
    expect(tpl.params[0].name).toBe('output_dir');
    expect(JSON.stringify(tpl.plan)).toContain('{{output_dir}}');
  });

  it('formats template', () => {
    const output = formatTemplate(makeTemplate());
    expect(output).toContain('Build Project');
    expect(output).toContain('output_dir');
    expect(output).toContain('required');
  });
});
