import type { RunSummary } from '../types/run-summary.js';
import { buildPayload, type WebhookPayload } from './webhook.js';

/** Notification channel types */
export type ChannelType = 'desktop' | 'email' | 'json_file';

/** Base notification channel configuration */
export interface BaseChannelConfig {
  type: ChannelType;
  /** Which events trigger this channel. Default: all. */
  events?: string[];
  /** Human-readable channel name */
  name?: string;
}

/** Desktop notification via process.stdout bell or external command */
export interface DesktopChannelConfig extends BaseChannelConfig {
  type: 'desktop';
  /** External command to run for notification. Receives JSON on stdin. */
  command?: string;
}

/** Email notification channel (SMTP) */
export interface EmailChannelConfig extends BaseChannelConfig {
  type: 'email';
  /** SMTP host */
  smtp_host: string;
  /** SMTP port. Default: 587. */
  smtp_port?: number;
  /** Sender address */
  from: string;
  /** Recipient addresses */
  to: string[];
  /** Optional subject template. Use {{status}}, {{run_id}}, {{task_id}} placeholders. */
  subject_template?: string;
}

/** JSON file notification (append to a file) */
export interface JsonFileChannelConfig extends BaseChannelConfig {
  type: 'json_file';
  /** File path to append notifications to */
  path: string;
}

export type NotificationChannelConfig =
  | DesktopChannelConfig
  | EmailChannelConfig
  | JsonFileChannelConfig;

/** Result of sending a notification */
export interface NotificationResult {
  channel: string;
  type: ChannelType;
  success: boolean;
  error?: string;
}

/**
 * Send notifications to all configured channels.
 */
export async function sendNotifications(
  channels: NotificationChannelConfig[],
  summary: RunSummary,
): Promise<NotificationResult[]> {
  const payload = buildPayload(summary);
  const results: NotificationResult[] = [];

  for (const channel of channels) {
    // Check event filter
    if (channel.events && channel.events.length > 0) {
      if (!channel.events.includes(payload.event)) continue;
    }

    const name = channel.name ?? channel.type;

    try {
      await sendToChannel(channel, payload, summary);
      results.push({ channel: name, type: channel.type, success: true });
    } catch (err: unknown) {
      results.push({
        channel: name,
        type: channel.type,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

async function sendToChannel(
  config: NotificationChannelConfig,
  payload: WebhookPayload,
  summary: RunSummary,
): Promise<void> {
  switch (config.type) {
    case 'desktop':
      return sendDesktop(config, payload);
    case 'email':
      return sendEmail(config, payload, summary);
    case 'json_file':
      return sendJsonFile(config, payload);
  }
}

async function sendDesktop(config: DesktopChannelConfig, payload: WebhookPayload): Promise<void> {
  const { execSync } = await import('node:child_process');

  if (config.command) {
    // Pipe JSON to external command
    const json = JSON.stringify(payload);
    execSync(config.command, { input: json, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
  } else {
    // Terminal bell + formatted message
    const icon = payload.status === 'completed' || payload.status === 'verified' ? '✓' : '✗';
    const msg = `\x07[Continuum] ${icon} Run ${payload.run_id.slice(0, 8)} ${payload.status} (${payload.duration_ms ?? 0}ms)`;
    process.stderr.write(msg + '\n');
  }
}

async function sendEmail(
  config: EmailChannelConfig,
  payload: WebhookPayload,
  _summary: RunSummary,
): Promise<void> {
  const net = await import('node:net');

  const port = config.smtp_port ?? 587;
  const subject = renderTemplate(
    config.subject_template ?? '[Continuum] Run {{run_id}} {{status}}',
    payload,
  );

  const body = formatEmailBody(payload);
  const to = config.to.join(', ');

  // Simple SMTP send (no auth, suitable for local relay or internal SMTP)
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection(port, config.smtp_host);
    const lines = [
      `EHLO continuum`,
      `MAIL FROM:<${config.from}>`,
      ...config.to.map((addr) => `RCPT TO:<${addr}>`),
      'DATA',
      `From: ${config.from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n.`,
      'QUIT',
    ];

    let lineIndex = 0;
    let dataSent = false;

    socket.setEncoding('utf8');
    socket.setTimeout(10_000);

    socket.on('data', () => {
      if (lineIndex < lines.length) {
        socket.write(lines[lineIndex] + '\r\n');
        lineIndex++;
      } else if (!dataSent) {
        dataSent = true;
        resolve();
      }
    });

    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('SMTP connection timed out'));
    });
  });
}

async function sendJsonFile(config: JsonFileChannelConfig, payload: WebhookPayload): Promise<void> {
  const { appendFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');

  mkdirSync(dirname(config.path), { recursive: true });
  appendFileSync(config.path, JSON.stringify(payload) + '\n', 'utf8');
}

function renderTemplate(template: string, payload: WebhookPayload): string {
  return template
    .replace(/\{\{run_id\}\}/g, payload.run_id.slice(0, 8))
    .replace(/\{\{status\}\}/g, payload.status)
    .replace(/\{\{task_id\}\}/g, payload.task_id)
    .replace(/\{\{event\}\}/g, payload.event)
    .replace(/\{\{duration_ms\}\}/g, String(payload.duration_ms ?? 0));
}

function formatEmailBody(payload: WebhookPayload): string {
  return [
    `Continuum Runtime Notification`,
    ``,
    `Event: ${payload.event}`,
    `Run: ${payload.run_id}`,
    `Task: ${payload.task_id}`,
    `Status: ${payload.status}`,
    `Duration: ${payload.duration_ms ?? 0}ms`,
    `Steps: ${payload.steps_total} total, ${payload.steps_failed} failed`,
    ...(payload.assertions_total !== undefined
      ? [`Assertions: ${payload.assertions_passed}/${payload.assertions_total} passed`]
      : []),
    ``,
    `Timestamp: ${payload.timestamp}`,
    `Plan hash: ${payload.plan_hash}`,
  ].join('\n');
}
