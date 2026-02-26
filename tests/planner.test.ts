import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { hashString } from '../src/core/hasher.js';
import type { TaskSpec } from '../src/types/task-spec.js';

// Shared mock for messages.create — all Anthropic instances use this
const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

// Import after mock is set up
const { generatePlan, SYSTEM_PROMPT_HASH, getSystemPrompt } = await import('../src/core/planner.js');

function makeTask(overrides?: Partial<TaskSpec>): TaskSpec {
  return {
    task_id: randomUUID(),
    prompt: 'Create an Express API with GET /health',
    model: 'claude-sonnet-4-20250514',
    ...overrides,
  };
}

function makeValidPlanJson(planId?: string) {
  return JSON.stringify({
    plan_id: planId ?? randomUUID(),
    description: 'Express API with health endpoint',
    steps: [
      {
        step_id: 'create-package-json',
        type: 'create_file',
        description: 'Create package.json',
        path: 'package.json',
        content: '{"name":"api","version":"1.0.0"}',
        determinism: 'guaranteed',
      },
      {
        step_id: 'create-index',
        type: 'create_file',
        description: 'Create index.js',
        path: 'index.js',
        content: 'const express = require("express");\nconst app = express();\napp.get("/health", (req, res) => res.json({ok:true}));\nmodule.exports = app;',
        determinism: 'guaranteed',
      },
      {
        step_id: 'npm-install',
        type: 'run_command',
        description: 'Install dependencies',
        command: 'npm',
        args: ['install', '--save-exact'],
        determinism: 'best_effort',
      },
    ],
  });
}

function mockLLMResponse(text: string, model?: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
    model: model ?? 'claude-sonnet-4-20250514',
  });
}

describe('planner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SYSTEM_PROMPT_HASH matches the actual system prompt', () => {
    const computed = hashString(getSystemPrompt());
    expect(SYSTEM_PROMPT_HASH).toBe(computed);
  });

  it('system_prompt_hash changes when prompt text changes', () => {
    const hash1 = hashString('prompt version 1');
    const hash2 = hashString('prompt version 2');
    expect(hash1).not.toBe(hash2);
  });

  it('generates a valid execution plan from LLM response', async () => {
    mockLLMResponse(makeValidPlanJson());
    const task = makeTask();
    const plan = await generatePlan(task);

    expect(plan.plan_id).toBeDefined();
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0].type).toBe('create_file');
    expect(plan.steps[2].type).toBe('run_command');
  });

  it('attaches planner_signature to LLM-generated plan', async () => {
    mockLLMResponse(makeValidPlanJson(), 'claude-sonnet-4-20250514');
    const task = makeTask();
    const plan = await generatePlan(task);

    expect(plan.planner_signature).toBeDefined();
    expect(plan.planner_signature!.planner_model).toBe('claude-sonnet-4-20250514');
    expect(plan.planner_signature!.planner_version).toBe('claude-sonnet-4-20250514');
    expect(plan.planner_signature!.system_prompt_hash).toBe(SYSTEM_PROMPT_HASH);
    expect(plan.planner_signature!.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws on invalid JSON from LLM', async () => {
    mockLLMResponse('This is not JSON at all');
    const task = makeTask();
    await expect(generatePlan(task)).rejects.toThrow('LLM returned invalid JSON');
  });

  it('throws on valid JSON but invalid plan schema', async () => {
    mockLLMResponse(JSON.stringify({ invalid: true }));
    const task = makeTask();
    await expect(generatePlan(task)).rejects.toThrow('Invalid ExecutionPlan');
  });

  it('throws when LLM response has no text content', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [],
      model: 'claude-sonnet-4-20250514',
    });
    const task = makeTask();
    await expect(generatePlan(task)).rejects.toThrow('No text content');
  });

  it('includes context in user message when provided', async () => {
    mockLLMResponse(makeValidPlanJson());
    const task = makeTask({ context: { framework: 'express', port: 3000 } });
    await generatePlan(task);

    const call = mockCreate.mock.calls[0][0];
    const userMsg = call.messages[0].content;
    expect(userMsg).toContain('express');
    expect(userMsg).toContain('3000');
  });

  it('passes correct model to Anthropic API', async () => {
    mockLLMResponse(makeValidPlanJson(), 'claude-opus-4-20250514');
    const task = makeTask({ model: 'claude-opus-4-20250514' });
    await generatePlan(task);

    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe('claude-opus-4-20250514');
  });
});
