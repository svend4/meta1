import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import type { ExecutionPlan } from '../types/execution-plan.js';
import type { DriftVector } from '../types/drift-vector.js';
import type { AssertionResult } from '../types/assertion.js';
import type { DependencyFingerprint } from '../types/dependency-fingerprint.js';
import type { RepairResponse, RepairConstraints } from '../types/repair.js';
import type { PlannerSignature } from '../types/execution-plan.js';
import type { EventLogger } from './logger.js';
import { createEvent } from './logger.js';
import { hashString, hashObject } from './hasher.js';
import { assertValidPlan } from './validator.js';
import { DEFAULT_REPAIR_CONSTRAINTS } from '../types/repair.js';

/**
 * Extract JSON from LLM text that may contain markdown fences,
 * explanatory text, or other noise around the JSON object.
 */
export function extractJson(raw: string): string {
  let text = raw.trim();

  // Strip markdown code fences
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  }

  // If text doesn't start with '{', try to find JSON object boundaries
  if (!text.startsWith('{')) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1);
    }
  }

  return text;
}

const REPAIR_PROMPT_TEMPLATE = `You are the Continuum Repair Compiler. A verified execution plan has drifted from its expected state.

ORIGINAL PLAN HASH: {PLAN_HASH}

DRIFT VECTORS (what changed):
{DRIFT_VECTORS}

FAILED ASSERTIONS (what's broken):
{FAILED_ASSERTIONS}

ENVIRONMENT DIFF:
{ENV_DIFF}

CONSTRAINTS:
- Maximum {MAX_STEPS} steps may be modified
- Step IDs must be preserved (do not rename or reorder)
- Allowed mutations: {ALLOWED_MUTATIONS}
- You may NOT add or remove steps

OUTPUT: Return a complete ExecutionPlan JSON with mutations applied. Include a mutations_applied array documenting each change.

Response format (JSON only, no markdown):
{
  "repaired_plan": { ... the complete plan ... },
  "mutations_applied": [
    {
      "type": "modify_content" | "modify_command" | "update_version" | "update_assertion",
      "step_id": "...",
      "description": "what was changed and why",
      "before_hash": "sha256:...",
      "after_hash": "sha256:..."
    }
  ]
}

RULES:
1. MINIMUM VIABLE REPAIR. Fix what's broken, nothing else.
2. Do NOT restructure the plan.
3. Do NOT add features.
4. Do NOT remove any existing assertions.
5. All original assertions must be achievable with the repaired plan.`;

/**
 * Level 3: LLM Repair Compiler.
 * One attempt. Structured request. Constrained mutations.
 */
export async function repairWithLLM(
  originalPlan: ExecutionPlan,
  driftVectors: DriftVector[],
  failedAssertions: AssertionResult[],
  originalFingerprint: DependencyFingerprint | undefined,
  currentFingerprint: DependencyFingerprint | undefined,
  logger: EventLogger,
  runId: string,
  options?: { apiKey?: string },
): Promise<RepairResponse | null> {
  const constraints = DEFAULT_REPAIR_CONSTRAINTS;
  const repairId = randomUUID();
  const planHash = hashObject(originalPlan);

  // Build the repair prompt
  const prompt = REPAIR_PROMPT_TEMPLATE
    .replace('{PLAN_HASH}', planHash)
    .replace('{DRIFT_VECTORS}', JSON.stringify(driftVectors, null, 2))
    .replace('{FAILED_ASSERTIONS}', JSON.stringify(failedAssertions, null, 2))
    .replace('{ENV_DIFF}', JSON.stringify({
      original: originalFingerprint ?? 'not available',
      current: currentFingerprint ?? 'not available',
    }, null, 2))
    .replace('{MAX_STEPS}', String(constraints.max_steps_modified))
    .replace('{ALLOWED_MUTATIONS}', constraints.allowed_mutations.join(', '));

  const promptHash = hashString(prompt);
  const model = 'claude-sonnet-4-20250514';

  logger.log(createEvent('repair_llm_called', runId, {
    repair_id: repairId,
    prompt_hash: promptHash,
    model,
    budget: constraints.budget,
  }));

  try {
    const client = new Anthropic({ apiKey: options?.apiKey, maxRetries: 4 });

    // Enforce budget timeout via AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), constraints.budget.timeout_ms);

    let response: Anthropic.Message;
    try {
      response = await client.messages.create(
        {
          model,
          max_tokens: constraints.budget.max_tokens,
          system: 'You are the Continuum Repair Compiler. Output ONLY valid JSON. No markdown, no explanation.',
          messages: [
            {
              role: 'user',
              content: `${prompt}\n\nOriginal plan:\n${JSON.stringify(originalPlan, null, 2)}`,
            },
          ],
        },
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return null;
    }

    let parsed: { repaired_plan: unknown; mutations_applied: unknown[] };
    try {
      const cleanText = extractJson(textBlock.text);
      parsed = JSON.parse(cleanText);
    } catch {
      logger.log(createEvent('repair_plan_received', runId, {
        repair_id: repairId,
        repaired_plan_hash: 'sha256:' + '0'.repeat(64) as `sha256:${string}`,
        mutations: [],
        error: 'Failed to parse LLM response as JSON',
      }));
      return null;
    }

    // Validate the repaired plan
    try {
      assertValidPlan(parsed.repaired_plan);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.log(createEvent('repair_plan_received', runId, {
        repair_id: repairId,
        repaired_plan_hash: 'sha256:' + '0'.repeat(64) as `sha256:${string}`,
        mutations: [],
        error: `Repaired plan failed validation: ${msg}`,
      }));
      return null;
    }

    const repairedPlan = parsed.repaired_plan as ExecutionPlan;
    const mutations = (parsed.mutations_applied ?? []) as RepairResponse['mutations_applied'];

    // Validate constraints
    const violations = validateRepairConstraints(originalPlan, repairedPlan, mutations, constraints);
    if (violations.length > 0) {
      logger.log(createEvent('repair_plan_received', runId, {
        repair_id: repairId,
        repaired_plan_hash: hashObject(repairedPlan),
        mutations: mutations.map((m) => `${m.type}:${m.step_id}`),
        error: `Constraint violations: ${violations.join('; ')}`,
      }));
      return null;
    }

    const repairSignature: PlannerSignature = {
      planner_model: model,
      planner_version: response.model,
      system_prompt_hash: promptHash,
      generated_at: new Date().toISOString(),
    };

    const repairResponse: RepairResponse = {
      repaired_plan: repairedPlan,
      mutations_applied: mutations,
      repair_signature: repairSignature,
    };

    const repairedPlanHash = hashObject(repairedPlan);
    logger.log(createEvent('repair_plan_received', runId, {
      repair_id: repairId,
      repaired_plan_hash: repairedPlanHash,
      mutations: mutations.map((m) => `${m.type}:${m.step_id}`),
    }));

    return repairResponse;
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const errorMsg = isTimeout
      ? `Repair budget timeout exceeded (${constraints.budget.timeout_ms}ms)`
      : (err instanceof Error ? err.message : String(err));

    logger.log(createEvent('repair_plan_received', runId, {
      repair_id: repairId,
      repaired_plan_hash: 'sha256:' + '0'.repeat(64) as `sha256:${string}`,
      mutations: [],
      error: errorMsg,
    }));

    return null;
  }
}

/** Validate that repair output respects constraints */
function validateRepairConstraints(
  original: ExecutionPlan,
  repaired: ExecutionPlan,
  mutations: RepairResponse['mutations_applied'],
  constraints: RepairConstraints,
): string[] {
  const violations: string[] = [];

  // Check max steps modified
  if (mutations.length > constraints.max_steps_modified) {
    violations.push(`Too many mutations: ${mutations.length} > ${constraints.max_steps_modified}`);
  }

  // Check step IDs preserved
  if (constraints.preserve_step_ids) {
    const originalIds = new Set(original.steps.map((s) => s.step_id));
    const repairedIds = new Set(repaired.steps.map((s) => s.step_id));

    for (const id of originalIds) {
      if (!repairedIds.has(id)) {
        violations.push(`Step removed: ${id}`);
      }
    }
    for (const id of repairedIds) {
      if (!originalIds.has(id)) {
        violations.push(`Step added: ${id}`);
      }
    }
  }

  // Check step count unchanged (no add/remove in MVP)
  if (original.steps.length !== repaired.steps.length) {
    violations.push(`Step count changed: ${original.steps.length} → ${repaired.steps.length}`);
  }

  // Check mutation types allowed
  for (const m of mutations) {
    if (!constraints.allowed_mutations.includes(m.type)) {
      violations.push(`Disallowed mutation type: ${m.type}`);
    }
  }

  return violations;
}
