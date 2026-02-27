import { existsSync, mkdirSync, appendFileSync, readFileSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { getBaseDir } from './paths.js';

/** Types of auditable actions */
export type AuditAction =
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'tag.added'
  | 'tag.removed'
  | 'tag.deleted'
  | 'tag.renamed'
  | 'archive.created'
  | 'archive.restored'
  | 'archive.deleted'
  | 'annotation.added'
  | 'annotation.removed'
  | 'plan.frozen'
  | 'checkpoint.saved'
  | 'checkpoint.removed'
  | 'cleanup.executed';

/** A single audit log entry */
export interface AuditEntry {
  timestamp: string;
  action: AuditAction;
  actor: string;
  target_id: string;
  details?: Record<string, unknown>;
}

/** Options for querying audit entries */
export interface AuditQueryOptions {
  /** Filter by action type */
  action?: AuditAction;
  /** Filter by target ID (run_id, archive_id, etc.) */
  targetId?: string;
  /** Only entries after this date */
  since?: string;
  /** Only entries before this date */
  until?: string;
  /** Maximum number of entries to return */
  limit?: number;
}

function getAuditLogPath(): string {
  return join(getBaseDir(), 'audit.jsonl');
}

/**
 * Append an audit entry to the immutable log.
 */
export function audit(
  action: AuditAction,
  targetId: string,
  details?: Record<string, unknown>,
): void {
  const dir = getBaseDir();
  mkdirSync(dir, { recursive: true });

  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    action,
    actor: process.env.USER ?? process.env.USERNAME ?? 'unknown',
    target_id: targetId,
    details,
  };

  appendFileSync(getAuditLogPath(), JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * Read all audit entries (synchronous, for smaller logs).
 */
export function readAuditLog(options?: AuditQueryOptions): AuditEntry[] {
  const logPath = getAuditLogPath();
  if (!existsSync(logPath)) return [];

  const content = readFileSync(logPath, 'utf8');
  let entries = content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as AuditEntry);

  entries = applyFilters(entries, options);

  if (options?.limit) {
    entries = entries.slice(-options.limit);
  }

  return entries;
}

/**
 * Stream audit entries (async, for large logs).
 */
export async function streamAuditLog(
  callback: (entry: AuditEntry) => void,
  options?: AuditQueryOptions,
): Promise<number> {
  const logPath = getAuditLogPath();
  if (!existsSync(logPath)) return 0;

  const rl = createInterface({
    input: createReadStream(logPath),
    crlfDelay: Infinity,
  });

  let count = 0;
  let emitted = 0;
  const limit = options?.limit ?? Infinity;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as AuditEntry;

    if (matchesFilters(entry, options)) {
      count++;
      // For limited queries, we need to count from the end, so buffer
      callback(entry);
      emitted++;
      if (emitted >= limit) break;
    }
  }

  return count;
}

/**
 * Get audit trail for a specific target (run, archive, etc.).
 */
export function getAuditTrail(targetId: string): AuditEntry[] {
  return readAuditLog({ targetId });
}

/**
 * Format audit entries for display.
 */
export function formatAuditLog(entries: AuditEntry[]): string {
  if (entries.length === 0) return 'No audit entries.';

  const lines: string[] = [];

  for (const e of entries) {
    const ts = e.timestamp.slice(0, 19).replace('T', ' ');
    const details = e.details ? ` ${JSON.stringify(e.details)}` : '';
    lines.push(`${ts}  ${e.action.padEnd(22)}  ${e.target_id}  [${e.actor}]${details}`);
  }

  return lines.join('\n');
}

// ── Internal ──

function applyFilters(entries: AuditEntry[], options?: AuditQueryOptions): AuditEntry[] {
  if (!options) return entries;

  return entries.filter((e) => matchesFilters(e, options));
}

function matchesFilters(entry: AuditEntry, options?: AuditQueryOptions): boolean {
  if (!options) return true;

  if (options.action && entry.action !== options.action) return false;
  if (options.targetId && entry.target_id !== options.targetId) return false;
  if (options.since && entry.timestamp < options.since) return false;
  if (options.until && entry.timestamp > options.until) return false;

  return true;
}
