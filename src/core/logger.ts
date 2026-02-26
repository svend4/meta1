import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Event } from '../types/events.js';
import { getEventsPath } from './paths.js';

/**
 * Append-only JSONL event logger.
 * Each run gets its own events.jsonl file.
 */
export class EventLogger {
  private readonly path: string;

  constructor(runId: string) {
    this.path = getEventsPath(runId);
    mkdirSync(dirname(this.path), { recursive: true });
  }

  /** Append a single event to the JSONL log */
  log(event: Event): void {
    const line = JSON.stringify(event) + '\n';
    appendFileSync(this.path, line, 'utf8');
  }

  /** Get the file path of this event log */
  getPath(): string {
    return this.path;
  }
}

/** Create a timestamped event with the given fields */
export function createEvent<T extends Event['type']>(
  type: T,
  runId: string,
  fields: Omit<Extract<Event, { type: T }>, 'type' | 'ts' | 'run_id'>,
): Extract<Event, { type: T }> {
  return {
    type,
    ts: new Date().toISOString(),
    run_id: runId,
    ...fields,
  } as Extract<Event, { type: T }>;
}
