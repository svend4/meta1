import Anthropic from '@anthropic-ai/sdk';
import type { TaskSpec } from '../types/task-spec.js';
import type { ExecutionPlan, PlannerSignature } from '../types/execution-plan.js';
import type { TokenUsage } from '../types/run-summary.js';
import { hashString } from './hasher.js';
import { assertValidPlan } from './validator.js';

const SYSTEM_PROMPT = `You are the Continuum Runtime Planner v3.0. Convert a natural language task into a deterministic execution plan.

CRITICAL RULES:
1. Output ONLY valid JSON matching the ExecutionPlan v3.0 schema. No markdown, no explanation.
2. The plan MUST have EXACTLY these top-level fields: "plan_id" (uuid v4), "version" ("3.0"), "description", "steps" (array), "assertions" (array).
3. EVERY step in the "steps" array MUST have EXACTLY these fields: "step_id", "type", "description", "determinism", AND type-specific fields.

STEP TYPE 1: "create_file"
MUST include exactly: "path" (string) and "content" (string).
Determinism MUST be "guaranteed".
Example:
{
  "step_id": "create-index",
  "type": "create_file",
  "description": "Create main file",
  "determinism": "guaranteed",
  "path": "index.js",
  "content": "console.log('hello');"
}

STEP TYPE 2: "run_command"
MUST include exactly: "command" (string) and "args" (array of strings).
Determinism MUST be "best_effort" for installs/builds/tests.
Example:
{
  "step_id": "npm-install",
  "type": "run_command",
  "description": "Install deps",
  "determinism": "best_effort",
  "command": "npm",
  "args":["install", "express@4.21.2", "--save-exact"]
}

ASSERTIONS:
Classify stability: "stable" (files/exit codes), "flaky" (http/network).
CRITICAL: The "spec" object inside each assertion MUST ALSO include the "type" field matching the assertion type!

ASSERTION EXAMPLE:
{
  "assertion_id": "check-ping",
  "type": "http_response",
  "description": "Verify API",
  "required": true,
  "stability": "flaky",
  "spec": {
    "type": "http_response",
    "method": "GET",
    "url": "http://localhost:3000/ping",
    "expected_status": 200,
    "startup_command": "node index.js",
    "startup_timeout_ms": 3000,
    "shutdown_after": true
  }
}

Do NOT invent new step types or assertion types.`;

/** Pre-computed hash of the system prompt, used for cache keys and planner_signature */
export const SYSTEM_PROMPT_HASH = hashString(SYSTEM_PROMPT);

export interface PlannerOptions {
  apiKey?: string;
}

/** Result of plan generation, including the plan and token usage */
export interface PlanGenerationResult {
  plan: ExecutionPlan;
  tokenUsage: TokenUsage;
}

/** Model pricing per million tokens (USD) */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
};

/** Estimate cost in USD for token usage */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Try exact match first, then prefix match
  const pricing = MODEL_PRICING[model]
    ?? Object.entries(MODEL_PRICING).find(([k]) => model.startsWith(k.replace(/-\d{8}$/, '')))?.[1];

  if (!pricing) return 0;

  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/**
 * Generate an execution plan from a task specification using Claude.
 * v3.5: Now returns PlanGenerationResult with token usage. Backward-compatible wrapper below.
 */
export async function generatePlanWithUsage(
  task: TaskSpec,
  options?: PlannerOptions,
): Promise<PlanGenerationResult> {
  const client = new Anthropic({ apiKey: options?.apiKey });

  let userMessage = task.prompt;
  if (task.context && Object.keys(task.context).length > 0) {
    userMessage += `\n\nContext:\n${JSON.stringify(task.context, null, 2)}`;
  }

  const response = await client.messages.create({
    model: task.model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  // Extract text content from response
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text content in LLM response');
  }

  // Parse and validate the plan
  let plan: unknown;
  try {
    let cleanJson = textBlock.text.trim();
    // Вырезаем маркдаун, если Клод его добавил
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    }
    plan = JSON.parse(cleanJson);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${textBlock.text.slice(0, 200)}`);
  }

  assertValidPlan(plan);
  const validPlan = plan as ExecutionPlan;

  // Attach planner signature
  const signature: PlannerSignature = {
    planner_model: task.model,
    planner_version: response.model,
    system_prompt_hash: SYSTEM_PROMPT_HASH,
    generated_at: new Date().toISOString(),
  };
  validPlan.planner_signature = signature;

  // Capture token usage
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const tokenUsage: TokenUsage = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_usd: estimateCost(task.model, inputTokens, outputTokens),
    model: task.model,
  };

  return { plan: validPlan, tokenUsage };
}

/**
 * Generate an execution plan (backward-compatible wrapper).
 * Use generatePlanWithUsage() to also get token usage.
 */
export async function generatePlan(
  task: TaskSpec,
  options?: PlannerOptions,
): Promise<ExecutionPlan> {
  const result = await generatePlanWithUsage(task, options);
  return result.plan;
}

/** Get the system prompt (for testing/inspection) */
export function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}
