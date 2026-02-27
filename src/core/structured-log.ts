/**
 * Structured logging output for piping to ELK, Datadog, Splunk, etc.
 * Produces one JSON line per log entry with standardized fields.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** A structured log entry */
export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: 'continuum';
  version: string;
  run_id?: string;
  step_id?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

/** Output sink for structured logs */
export type LogSink = (entry: StructuredLogEntry) => void;

/** Default sink: write to stdout as JSONL */
export const stdoutSink: LogSink = (entry) => {
  process.stdout.write(JSON.stringify(entry) + '\n');
};

/** Collect entries in an array (for testing) */
export function createArraySink(): { sink: LogSink; entries: StructuredLogEntry[] } {
  const entries: StructuredLogEntry[] = [];
  return {
    sink: (entry) => entries.push(entry),
    entries,
  };
}

/**
 * Structured logger that outputs JSON lines.
 * Each method produces a single JSON line to the configured sink.
 */
export class StructuredLogger {
  private readonly sink: LogSink;
  private readonly version: string;
  private readonly runId?: string;
  private readonly extraFields: Record<string, unknown>;

  constructor(options: {
    sink?: LogSink;
    version?: string;
    runId?: string;
    fields?: Record<string, unknown>;
  } = {}) {
    this.sink = options.sink ?? stdoutSink;
    this.version = options.version ?? '3.6.0';
    this.runId = options.runId;
    this.extraFields = options.fields ?? {};
  }

  /** Create a child logger with additional fields */
  child(fields: Record<string, unknown>): StructuredLogger {
    return new StructuredLogger({
      sink: this.sink,
      version: this.version,
      runId: this.runId,
      fields: { ...this.extraFields, ...fields },
    });
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.emit('debug', message, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.emit('info', message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.emit('warn', message, fields);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.emit('error', message, fields);
  }

  private emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: 'continuum',
      version: this.version,
      ...(this.runId ? { run_id: this.runId } : {}),
      ...this.extraFields,
      ...fields,
    };

    this.sink(entry);
  }
}

/**
 * Convert a run summary event log to structured log entries.
 * Useful for re-exporting existing run events in structured format.
 */
export function eventsToStructuredLog(
  events: Array<{ type: string; ts: string; run_id: string; [key: string]: unknown }>,
): StructuredLogEntry[] {
  return events.map((event) => {
    const { type, ts, run_id, ...rest } = event;
    const level = inferLevel(type);

    return {
      timestamp: ts,
      level,
      message: type,
      service: 'continuum' as const,
      version: '3.6.0',
      run_id,
      event_type: type,
      ...rest,
    };
  });
}

function inferLevel(eventType: string): LogLevel {
  if (eventType.includes('failed') || eventType.includes('error')) return 'error';
  if (eventType.includes('warning') || eventType.includes('drift')) return 'warn';
  if (eventType.includes('start') || eventType.includes('complete')) return 'info';
  return 'debug';
}
