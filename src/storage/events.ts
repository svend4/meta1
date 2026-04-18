import { readFileSync, existsSync } from 'node:fs';
import type { Event } from '../types/events.js';
import { getEventsPath } from '../core/paths.js';

/** Read all events for a run from its JSONL file */
export function readEvents(runId: string): Event[] {
  const path = getEventsPath(runId);
  if (!existsSync(path)) {
    throw new Error(`Event log not found for run ${runId}: ${path}`);
  }
  const content = readFileSync(path, 'utf8');
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Event);
}

/** Read events of a specific type */
export function readEventsOfType<T extends Event['type']>(
  runId: string,
  type: T,
): Extract<Event, { type: T }>[] {
  return readEvents(runId).filter(
    (e): e is Extract<Event, { type: T }> => e.type === type,
  );
}
