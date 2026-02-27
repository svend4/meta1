import { describe, it, expect } from 'vitest';
import { EventBus, createEventBus } from '../../src/core/event-bus.js';
import type { Event, RunStartEvent, StepStartEvent } from '../../src/types/events.js';

function makeRunStart(runId = 'run-1'): RunStartEvent {
  return { type: 'run_start', ts: new Date().toISOString(), run_id: runId, task_id: 't1', prompt: 'test' };
}

function makeStepStart(runId = 'run-1', stepId = 's1'): StepStartEvent {
  return { type: 'step_start', ts: new Date().toISOString(), run_id: runId, step_id: stepId, step_type: 'run_command', step_index: 0 };
}

describe('EventBus', () => {
  it('creates with factory', () => {
    const bus = createEventBus();
    expect(bus).toBeInstanceOf(EventBus);
  });

  it('delivers events to matching subscribers', async () => {
    const bus = new EventBus();
    const events: Event[] = [];

    bus.on({ types: ['run_start'] }, (e) => { events.push(e); });
    await bus.publish(makeRunStart());

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('run_start');
  });

  it('filters by event type', async () => {
    const bus = new EventBus();
    const events: Event[] = [];

    bus.on({ types: ['step_start'] }, (e) => { events.push(e); });
    await bus.publish(makeRunStart());

    expect(events).toHaveLength(0);
  });

  it('filters by run ID', async () => {
    const bus = new EventBus();
    const events: Event[] = [];

    bus.on({ runId: 'run-2' }, (e) => { events.push(e); });
    await bus.publish(makeRunStart('run-1'));
    await bus.publish(makeRunStart('run-2'));

    expect(events).toHaveLength(1);
    expect(events[0].run_id).toBe('run-2');
  });

  it('filters by step ID', async () => {
    const bus = new EventBus();
    const events: Event[] = [];

    bus.on({ stepId: 's2' }, (e) => { events.push(e); });
    await bus.publish(makeStepStart('run-1', 's1'));
    await bus.publish(makeStepStart('run-1', 's2'));

    expect(events).toHaveLength(1);
  });

  it('supports custom predicate filter', async () => {
    const bus = new EventBus();
    const events: Event[] = [];

    bus.on({ predicate: (e) => e.type.startsWith('run_') }, (e) => { events.push(e); });
    await bus.publish(makeRunStart());
    await bus.publish(makeStepStart());

    expect(events).toHaveLength(1);
  });

  it('unsubscribes by ID', async () => {
    const bus = new EventBus();
    const events: Event[] = [];

    const id = bus.on({}, (e) => { events.push(e); });
    await bus.publish(makeRunStart());
    expect(events).toHaveLength(1);

    bus.off(id);
    await bus.publish(makeRunStart());
    expect(events).toHaveLength(1);
  });

  it('once listener fires only once', async () => {
    const bus = new EventBus();
    const events: Event[] = [];

    bus.once({}, (e) => { events.push(e); });
    await bus.publish(makeRunStart());
    await bus.publish(makeRunStart());

    expect(events).toHaveLength(1);
  });

  it('onType subscribes to specific type', async () => {
    const bus = new EventBus();
    const events: RunStartEvent[] = [];

    bus.onType<RunStartEvent>('run_start', (e) => { events.push(e); });
    await bus.publish(makeRunStart());
    await bus.publish(makeStepStart());

    expect(events).toHaveLength(1);
  });

  it('onceType fires once for type', async () => {
    const bus = new EventBus();
    const events: Event[] = [];

    bus.onceType('run_start', (e) => { events.push(e); });
    await bus.publish(makeRunStart());
    await bus.publish(makeRunStart());

    expect(events).toHaveLength(1);
  });

  it('emit fires without awaiting', () => {
    const bus = new EventBus();
    const events: Event[] = [];

    bus.on({}, (e) => { events.push(e); });
    bus.emit(makeRunStart());

    // Emit is fire-and-forget, events may be delivered asynchronously
    expect(bus.subscriberCount).toBe(1);
  });

  it('tracks history', async () => {
    const bus = new EventBus();
    await bus.publish(makeRunStart());
    await bus.publish(makeStepStart());

    const history = bus.getHistory();
    expect(history).toHaveLength(2);
  });

  it('filters history', async () => {
    const bus = new EventBus();
    await bus.publish(makeRunStart());
    await bus.publish(makeStepStart());

    const filtered = bus.getHistory({ types: ['run_start'] });
    expect(filtered).toHaveLength(1);
  });

  it('limits history size', async () => {
    const bus = new EventBus({ maxHistory: 2 });
    await bus.publish(makeRunStart());
    await bus.publish(makeRunStart());
    await bus.publish(makeRunStart());

    expect(bus.getHistory()).toHaveLength(2);
  });

  it('tracks statistics', async () => {
    const bus = new EventBus();
    bus.on({ types: ['run_start'] }, () => {});

    await bus.publish(makeRunStart());
    await bus.publish(makeStepStart());

    const stats = bus.getStats();
    expect(stats.totalPublished).toBe(2);
    expect(stats.totalDelivered).toBe(1);
    expect(stats.totalDropped).toBe(1);
    expect(stats.subscriptionCount).toBe(1);
    expect(stats.eventCounts.run_start).toBe(1);
    expect(stats.eventCounts.step_start).toBe(1);
  });

  it('reset clears everything', async () => {
    const bus = new EventBus();
    bus.on({}, () => {});
    await bus.publish(makeRunStart());

    bus.reset();
    expect(bus.subscriberCount).toBe(0);
    expect(bus.getHistory()).toHaveLength(0);
    expect(bus.getStats().totalPublished).toBe(0);
  });

  it('waitFor resolves on matching event', async () => {
    const bus = new EventBus();

    const promise = bus.waitFor('run_start', 1000);
    await bus.publish(makeRunStart());

    const event = await promise;
    expect(event.type).toBe('run_start');
  });

  it('waitFor rejects on timeout', async () => {
    const bus = new EventBus();
    await expect(bus.waitFor('run_start', 50)).rejects.toThrow('Timeout');
  });

  it('swallows handler errors', async () => {
    const bus = new EventBus();
    bus.on({}, () => { throw new Error('boom'); });

    const delivered = await bus.publish(makeRunStart());
    // Error swallowed, delivery counted as 0 since it threw
    expect(delivered).toBe(0);
  });

  it('returns delivery count', async () => {
    const bus = new EventBus();
    bus.on({}, () => {});
    bus.on({}, () => {});

    const count = await bus.publish(makeRunStart());
    expect(count).toBe(2);
  });
});
