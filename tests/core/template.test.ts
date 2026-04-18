import { describe, it, expect } from 'vitest';
import { extractVariables, validateVariables, applyTemplate } from '../../src/core/template.js';
import type { ExecutionPlan, ExecutionPlanV3 } from '../../src/types/execution-plan.js';

function makeBasePlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    plan_id: 'tpl-plan',
    description: 'Deploy {{app_name}}',
    steps: [
      {
        step_id: 'create',
        type: 'create_file',
        description: 'Create config for {{app_name}}',
        path: '{{output_dir}}/config.json',
        content: '{"name": "{{app_name}}", "port": {{port}}}',
        determinism: 'guaranteed',
      },
      {
        step_id: 'run',
        type: 'run_command',
        description: 'Start {{app_name}}',
        command: '{{runtime}}',
        args: ['start', '--port', '{{port}}'],
        determinism: 'best_effort',
      },
    ],
    ...overrides,
  };
}

describe('extractVariables', () => {
  it('extracts all unique variable names from a plan', () => {
    const plan = makeBasePlan();
    const vars = extractVariables(plan);
    expect(vars).toEqual(['app_name', 'output_dir', 'port', 'runtime']);
  });

  it('returns empty array for plans with no variables', () => {
    const plan: ExecutionPlan = {
      plan_id: 'no-vars',
      steps: [
        {
          step_id: 's1',
          type: 'create_file',
          description: 'Plain file',
          path: 'hello.txt',
          content: 'world',
          determinism: 'guaranteed',
        },
      ],
    };
    expect(extractVariables(plan)).toEqual([]);
  });

  it('extracts from plan description', () => {
    const plan: ExecutionPlan = {
      plan_id: 'desc',
      description: 'Build {{project}}',
      steps: [
        {
          step_id: 's1',
          type: 'create_file',
          description: 'File',
          path: 'f.txt',
          content: 'c',
          determinism: 'guaranteed',
        },
      ],
    };
    expect(extractVariables(plan)).toEqual(['project']);
  });
});

describe('validateVariables', () => {
  it('returns missing variables when some are not provided', () => {
    const plan = makeBasePlan();
    const missing = validateVariables(plan, { app_name: 'test' });
    expect(missing).toContain('output_dir');
    expect(missing).toContain('port');
    expect(missing).toContain('runtime');
    expect(missing).not.toContain('app_name');
  });

  it('returns empty array when all variables are provided', () => {
    const plan = makeBasePlan();
    const missing = validateVariables(plan, {
      app_name: 'myapp',
      output_dir: 'dist',
      port: '3000',
      runtime: 'node',
    });
    expect(missing).toEqual([]);
  });

  it('considers plan-level defaults', () => {
    const plan = makeBasePlan() as ExecutionPlanV3;
    (plan as ExecutionPlanV3 & { variables: Record<string, string> }).variables = {
      output_dir: 'build',
      runtime: 'node',
    };

    const missing = validateVariables(plan, {
      app_name: 'myapp',
      port: '3000',
    });
    expect(missing).toEqual([]);
  });
});

describe('applyTemplate', () => {
  it('substitutes all variables in step fields', () => {
    const plan = makeBasePlan();
    const result = applyTemplate(plan, {
      app_name: 'myapp',
      output_dir: 'dist',
      port: '8080',
      runtime: 'node',
    });

    expect(result.description).toBe('Deploy myapp');

    const createStep = result.steps[0];
    expect(createStep.type).toBe('create_file');
    if (createStep.type === 'create_file') {
      expect(createStep.path).toBe('dist/config.json');
      expect(createStep.content).toBe('{"name": "myapp", "port": 8080}');
      expect(createStep.description).toBe('Create config for myapp');
    }

    const runStep = result.steps[1];
    expect(runStep.type).toBe('run_command');
    if (runStep.type === 'run_command') {
      expect(runStep.command).toBe('node');
      expect(runStep.args).toEqual(['start', '--port', '8080']);
      expect(runStep.description).toBe('Start myapp');
    }
  });

  it('throws if required variables are missing', () => {
    const plan = makeBasePlan();
    expect(() => applyTemplate(plan, { app_name: 'test' })).toThrow(
      'Missing template variables: output_dir, port, runtime',
    );
  });

  it('uses plan-level defaults for unset variables', () => {
    const plan = makeBasePlan() as ExecutionPlanV3;
    (plan as ExecutionPlanV3 & { variables: Record<string, string> }).variables = {
      output_dir: 'build',
      port: '3000',
      runtime: 'deno',
    };

    const result = applyTemplate(plan, { app_name: 'foo' });

    const createStep = result.steps[0];
    if (createStep.type === 'create_file') {
      expect(createStep.path).toBe('build/config.json');
      expect(createStep.content).toContain('3000');
    }

    const runStep = result.steps[1];
    if (runStep.type === 'run_command') {
      expect(runStep.command).toBe('deno');
    }
  });

  it('caller variables override plan defaults', () => {
    const plan = makeBasePlan() as ExecutionPlanV3;
    (plan as ExecutionPlanV3 & { variables: Record<string, string> }).variables = {
      app_name: 'default_app',
      output_dir: 'build',
      port: '3000',
      runtime: 'node',
    };

    const result = applyTemplate(plan, { app_name: 'override_app' });

    expect(result.description).toBe('Deploy override_app');
  });

  it('preserves non-template fields unchanged', () => {
    const plan = makeBasePlan();
    const result = applyTemplate(plan, {
      app_name: 'x',
      output_dir: 'y',
      port: '1',
      runtime: 'z',
    });

    expect(result.plan_id).toBe('tpl-plan');
    expect(result.steps[0].step_id).toBe('create');
    expect(result.steps[0].determinism).toBe('guaranteed');
  });
});
