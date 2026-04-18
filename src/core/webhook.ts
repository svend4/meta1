import { request } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { RunSummary } from '../types/run-summary.js';

export interface WebhookConfig {
  /** URL to POST to */
  url: string;
  /** Which events trigger the webhook. Default: all. */
  events?: WebhookEventType[];
  /** Optional secret for HMAC signature (X-Continuum-Signature header). */
  secret?: string;
  /** Timeout in ms. Default: 5000. */
  timeout_ms?: number;
}

export type WebhookEventType =
  | 'run_completed'
  | 'run_failed'
  | 'run_verified'
  | 'run_healed'
  | 'assertion_failed';

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  run_id: string;
  task_id: string;
  status: string;
  duration_ms?: number;
  plan_hash: string;
  run_hash?: string;
  steps_total: number;
  steps_failed: number;
  assertions_passed?: number;
  assertions_total?: number;
}

/**
 * Map a RunSummary status to a webhook event type.
 */
export function mapStatusToEvent(status: RunSummary['status']): WebhookEventType {
  switch (status) {
    case 'completed': return 'run_completed';
    case 'verified': return 'run_verified';
    case 'healed': return 'run_healed';
    case 'assertion_failed': return 'assertion_failed';
    case 'failed': return 'run_failed';
    case 'benign_drift': return 'run_completed';
  }
}

/**
 * Build a webhook payload from a RunSummary.
 */
export function buildPayload(summary: RunSummary): WebhookPayload {
  return {
    event: mapStatusToEvent(summary.status),
    timestamp: new Date().toISOString(),
    run_id: summary.run_id,
    task_id: summary.task_id,
    status: summary.status,
    duration_ms: summary.duration_ms,
    plan_hash: summary.plan_hash,
    run_hash: summary.run_hash,
    steps_total: summary.steps.length,
    steps_failed: summary.steps.filter((s) => s.status === 'failed').length,
    assertions_passed: summary.assertions_passed,
    assertions_total: summary.assertions_total,
  };
}

/**
 * Send a webhook notification for a completed run.
 * Non-blocking — failures are silently ignored (fire-and-forget).
 */
export async function sendWebhook(
  config: WebhookConfig,
  summary: RunSummary,
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const payload = buildPayload(summary);

  // Check if this event type is enabled
  if (config.events && config.events.length > 0) {
    if (!config.events.includes(payload.event)) {
      return { success: true };
    }
  }

  const body = JSON.stringify(payload);
  const timeout = config.timeout_ms ?? 5000;

  try {
    const statusCode = await postJson(config.url, body, timeout, config.secret);
    return { success: statusCode >= 200 && statusCode < 300, statusCode };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Send webhooks to all configured endpoints.
 */
export async function sendAllWebhooks(
  configs: WebhookConfig[],
  summary: RunSummary,
): Promise<{ url: string; success: boolean; error?: string }[]> {
  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const result = await sendWebhook(config, summary);
      return { url: config.url, ...result };
    }),
  );

  return results.map((r) => {
    if (r.status === 'fulfilled') return r.value;
    return { url: '(unknown)', success: false, error: String(r.reason) };
  });
}

function postJson(
  url: string,
  body: string,
  timeoutMs: number,
  secret?: string,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const reqFn = isHttps ? request : httpRequest;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body).toString(),
      'User-Agent': 'Continuum-Runtime/3.3',
    };

    if (secret) {
      const { createHmac } = require('node:crypto') as typeof import('node:crypto');
      const signature = createHmac('sha256', secret).update(body).digest('hex');
      headers['X-Continuum-Signature'] = `sha256=${signature}`;
    }

    const req = reqFn(
      url,
      { method: 'POST', headers, timeout: timeoutMs },
      (res) => {
        res.resume(); // drain
        resolve(res.statusCode ?? 0);
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Webhook timed out after ${timeoutMs}ms`));
    });

    req.write(body);
    req.end();
  });
}
