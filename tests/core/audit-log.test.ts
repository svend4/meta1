import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { audit, readAuditLog, getAuditTrail, formatAuditLog } from '../../src/core/audit-log.js';

let tempDir: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
}));

describe('audit-log', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-audit-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('appends audit entries', () => {
    audit('tag.added', 'run-1', { tag: 'production' });
    audit('tag.removed', 'run-1', { tag: 'production' });

    const entries = readAuditLog();
    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe('tag.added');
    expect(entries[1].action).toBe('tag.removed');
  });

  it('stores timestamp and actor', () => {
    audit('run.started', 'run-1');

    const entries = readAuditLog();
    expect(entries[0].timestamp).toBeTruthy();
    expect(entries[0].actor).toBeTruthy();
    expect(entries[0].target_id).toBe('run-1');
  });

  it('stores details', () => {
    audit('archive.created', 'archive-1', { run_count: 3 });

    const entries = readAuditLog();
    expect(entries[0].details).toEqual({ run_count: 3 });
  });

  it('returns empty for no log', () => {
    expect(readAuditLog()).toEqual([]);
  });

  it('filters by action', () => {
    audit('tag.added', 'run-1');
    audit('run.started', 'run-2');
    audit('tag.added', 'run-3');

    const entries = readAuditLog({ action: 'tag.added' });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.action === 'tag.added')).toBe(true);
  });

  it('filters by target ID', () => {
    audit('tag.added', 'run-1');
    audit('tag.added', 'run-2');
    audit('tag.removed', 'run-1');

    const entries = readAuditLog({ targetId: 'run-1' });
    expect(entries).toHaveLength(2);
  });

  it('filters by date range', () => {
    audit('run.started', 'run-1');

    const future = new Date(Date.now() + 86400000).toISOString();
    const entries = readAuditLog({ since: future });
    expect(entries).toHaveLength(0);
  });

  it('limits results', () => {
    audit('run.started', 'r1');
    audit('run.started', 'r2');
    audit('run.started', 'r3');

    const entries = readAuditLog({ limit: 2 });
    expect(entries).toHaveLength(2);
  });

  it('gets audit trail for a target', () => {
    audit('run.started', 'run-1');
    audit('tag.added', 'run-1', { tag: 'v1' });
    audit('run.started', 'run-2');
    audit('tag.added', 'run-1', { tag: 'v2' });

    const trail = getAuditTrail('run-1');
    expect(trail).toHaveLength(3);
    expect(trail.every((e) => e.target_id === 'run-1')).toBe(true);
  });

  it('formats audit log', () => {
    audit('tag.added', 'run-1', { tag: 'prod' });
    audit('run.completed', 'run-1');

    const entries = readAuditLog();
    const formatted = formatAuditLog(entries);
    expect(formatted).toContain('tag.added');
    expect(formatted).toContain('run.completed');
    expect(formatted).toContain('run-1');
  });

  it('formats empty log', () => {
    expect(formatAuditLog([])).toBe('No audit entries.');
  });

  it('is append-only (no modification of previous entries)', () => {
    audit('run.started', 'run-1');
    const before = readAuditLog();

    audit('tag.added', 'run-1');
    const after = readAuditLog();

    expect(after[0]).toEqual(before[0]); // First entry unchanged
    expect(after).toHaveLength(2);
  });
});
