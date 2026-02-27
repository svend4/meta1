import { describe, it, expect } from 'vitest';
import {
  StructuredLogger,
  createArraySink,
  eventsToStructuredLog,
} from '../../src/core/structured-log.js';

describe('StructuredLogger', () => {
  it('emits info log entry', () => {
    const { sink, entries } = createArraySink();
    const logger = new StructuredLogger({ sink, runId: 'run-1' });

    logger.info('Step completed', { step_id: 's1' });

    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('info');
    expect(entries[0].message).toBe('Step completed');
    expect(entries[0].service).toBe('continuum');
    expect(entries[0].run_id).toBe('run-1');
    expect(entries[0].step_id).toBe('s1');
    expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('emits all log levels', () => {
    const { sink, entries } = createArraySink();
    const logger = new StructuredLogger({ sink });

    logger.debug('debug msg');
    logger.info('info msg');
    logger.warn('warn msg');
    logger.error('error msg');

    expect(entries.map((e) => e.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('includes extra fields from constructor', () => {
    const { sink, entries } = createArraySink();
    const logger = new StructuredLogger({ sink, fields: { env: 'prod' } });

    logger.info('test');
    expect(entries[0].env).toBe('prod');
  });

  it('creates child logger with inherited fields', () => {
    const { sink, entries } = createArraySink();
    const parent = new StructuredLogger({ sink, runId: 'r1', fields: { env: 'prod' } });
    const child = parent.child({ step_id: 's1' });

    child.info('child log');

    expect(entries[0].run_id).toBe('r1');
    expect(entries[0].env).toBe('prod');
    expect(entries[0].step_id).toBe('s1');
  });

  it('per-call fields override constructor fields', () => {
    const { sink, entries } = createArraySink();
    const logger = new StructuredLogger({ sink, fields: { status: 'init' } });

    logger.info('update', { status: 'done' });
    expect(entries[0].status).toBe('done');
  });

  it('defaults version to 3.6.0', () => {
    const { sink, entries } = createArraySink();
    const logger = new StructuredLogger({ sink });

    logger.info('test');
    expect(entries[0].version).toBe('3.6.0');
  });

  it('custom version', () => {
    const { sink, entries } = createArraySink();
    const logger = new StructuredLogger({ sink, version: '4.0.0' });

    logger.info('test');
    expect(entries[0].version).toBe('4.0.0');
  });
});

describe('eventsToStructuredLog', () => {
  it('converts events to structured log entries', () => {
    const events = [
      { type: 'run_start', ts: '2026-01-01T00:00:00Z', run_id: 'r1', task_id: 't1' },
      { type: 'step_complete', ts: '2026-01-01T00:01:00Z', run_id: 'r1', step_id: 's1' },
      { type: 'run_failed', ts: '2026-01-01T00:02:00Z', run_id: 'r1', error: 'boom' },
    ];

    const entries = eventsToStructuredLog(events);

    expect(entries).toHaveLength(3);
    expect(entries[0].level).toBe('info');  // run_start
    expect(entries[0].message).toBe('run_start');
    expect(entries[1].level).toBe('info');  // step_complete
    expect(entries[2].level).toBe('error'); // run_failed
  });

  it('preserves extra fields', () => {
    const events = [
      { type: 'step_start', ts: '2026-01-01T00:00:00Z', run_id: 'r1', step_id: 's1', step_index: 0 },
    ];

    const entries = eventsToStructuredLog(events);
    expect(entries[0].step_id).toBe('s1');
    expect(entries[0].step_index).toBe(0);
  });
});
