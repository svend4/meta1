import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getForensicsDir, getHttpForensicsDir } from './paths.js';

/** A recorded HTTP call for forensics analysis */
export interface HttpForensicsRecord {
  record_id: string;
  timestamp: string;
  step_id: string;
  method: string;
  url: string;
  request_headers?: Record<string, string>;
  request_body?: string;
  response: {
    status: number;
    headers?: Record<string, string>;
    body_preview?: string;
  };
  duration_ms: number;
  error?: string;
}

/** A filesystem event for forensics tracking */
export interface FsForensicsRecord {
  record_id: string;
  timestamp: string;
  step_id: string;
  operation: 'create' | 'write' | 'delete' | 'chmod';
  path: string;
  size_bytes?: number;
  content_hash?: string;
}

/** Summary of forensics data for a step */
export interface StepForensicsSummary {
  step_id: string;
  http_calls: number;
  fs_operations: number;
  total_duration_ms: number;
  errors: string[];
}

/** Summary of forensics data for an entire run */
export interface RunForensicsSummary {
  run_id: string;
  generated_at: string;
  total_http_calls: number;
  total_fs_operations: number;
  steps: StepForensicsSummary[];
  timeline: Array<{
    timestamp: string;
    step_id: string;
    type: 'http' | 'fs';
    summary: string;
  }>;
}

/**
 * ForensicsRecorder: captures HTTP calls and FS events during execution
 * for post-mortem analysis when things go wrong.
 */
export class ForensicsRecorder {
  private readonly runId: string;
  private httpRecords: HttpForensicsRecord[] = [];
  private fsRecords: FsForensicsRecord[] = [];
  private enabled: boolean;

  constructor(runId: string, enabled = true) {
    this.runId = runId;
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Record an HTTP call */
  recordHttp(record: Omit<HttpForensicsRecord, 'record_id' | 'timestamp'>): void {
    if (!this.enabled) return;

    const full: HttpForensicsRecord = {
      ...record,
      record_id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    this.httpRecords.push(full);
    this.persistHttpRecord(full);
  }

  /** Record a filesystem operation */
  recordFs(record: Omit<FsForensicsRecord, 'record_id' | 'timestamp'>): void {
    if (!this.enabled) return;

    const full: FsForensicsRecord = {
      ...record,
      record_id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    this.fsRecords.push(full);
    this.persistFsRecord(full);
  }

  /** Persist a single HTTP record to disk */
  private persistHttpRecord(record: HttpForensicsRecord): void {
    const dir = getHttpForensicsDir(this.runId, record.step_id);
    mkdirSync(dir, { recursive: true });
    const filename = `${record.timestamp.replace(/[:.]/g, '-')}_${record.record_id.slice(0, 8)}.json`;
    writeFileSync(join(dir, filename), JSON.stringify(record, null, 2), 'utf8');
  }

  /** Persist a single FS record to disk */
  private persistFsRecord(record: FsForensicsRecord): void {
    const dir = join(getForensicsDir(this.runId), 'fs', record.step_id);
    mkdirSync(dir, { recursive: true });
    const filename = `${record.timestamp.replace(/[:.]/g, '-')}_${record.record_id.slice(0, 8)}.json`;
    writeFileSync(join(dir, filename), JSON.stringify(record, null, 2), 'utf8');
  }

  /** Get all HTTP records for a specific step */
  getHttpRecords(stepId?: string): HttpForensicsRecord[] {
    if (stepId) {
      return this.httpRecords.filter((r) => r.step_id === stepId);
    }
    return [...this.httpRecords];
  }

  /** Get all FS records for a specific step */
  getFsRecords(stepId?: string): FsForensicsRecord[] {
    if (stepId) {
      return this.fsRecords.filter((r) => r.step_id === stepId);
    }
    return [...this.fsRecords];
  }

  /** Generate a full forensics summary for the run */
  generateSummary(): RunForensicsSummary {
    const stepIds = new Set([
      ...this.httpRecords.map((r) => r.step_id),
      ...this.fsRecords.map((r) => r.step_id),
    ]);

    const steps: StepForensicsSummary[] = [];
    const timeline: RunForensicsSummary['timeline'] = [];

    for (const stepId of stepIds) {
      const httpCalls = this.httpRecords.filter((r) => r.step_id === stepId);
      const fsOps = this.fsRecords.filter((r) => r.step_id === stepId);
      const errors: string[] = [];

      for (const call of httpCalls) {
        if (call.error) errors.push(`HTTP ${call.method} ${call.url}: ${call.error}`);
        timeline.push({
          timestamp: call.timestamp,
          step_id: stepId,
          type: 'http',
          summary: `${call.method} ${call.url} → ${call.response.status} (${call.duration_ms}ms)`,
        });
      }

      for (const op of fsOps) {
        timeline.push({
          timestamp: op.timestamp,
          step_id: stepId,
          type: 'fs',
          summary: `${op.operation} ${op.path}${op.size_bytes ? ` (${op.size_bytes}b)` : ''}`,
        });
      }

      steps.push({
        step_id: stepId,
        http_calls: httpCalls.length,
        fs_operations: fsOps.length,
        total_duration_ms: httpCalls.reduce((sum, c) => sum + c.duration_ms, 0),
        errors,
      });
    }

    // Sort timeline chronologically
    timeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const summary: RunForensicsSummary = {
      run_id: this.runId,
      generated_at: new Date().toISOString(),
      total_http_calls: this.httpRecords.length,
      total_fs_operations: this.fsRecords.length,
      steps,
      timeline,
    };

    // Persist the summary
    const dir = getForensicsDir(this.runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

    return summary;
  }
}

/** Load a previously saved forensics summary from disk */
export function loadForensicsSummary(runId: string): RunForensicsSummary | null {
  const path = join(getForensicsDir(runId), 'summary.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Load all HTTP forensics records from disk for a run */
export function loadHttpRecords(runId: string, stepId?: string): HttpForensicsRecord[] {
  const httpDir = join(getForensicsDir(runId), 'http');
  if (!existsSync(httpDir)) return [];

  const records: HttpForensicsRecord[] = [];
  const stepDirs = stepId ? [stepId] : readdirSync(httpDir);

  for (const dir of stepDirs) {
    const stepPath = join(httpDir, dir);
    if (!existsSync(stepPath)) continue;
    const files = readdirSync(stepPath).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      try {
        records.push(JSON.parse(readFileSync(join(stepPath, file), 'utf8')));
      } catch {
        // Skip corrupted records
      }
    }
  }

  return records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
