/**
 * Run event bus — pub/sub event system for run lifecycle events,
 * step events, and custom hooks. Supports filtering, async handlers,
 * one-time listeners, and wildcard subscriptions.
 */

import type { Event, EventType } from '../types/events.js';

/** An event handler function */
export type EventHandler<T extends Event = Event> = (event: T) => void | Promise<void>;

/** A subscription filter */
export interface EventFilter {
  /** Specific event types to listen for */
  types?: EventType[];
  /** Filter by run ID */
  runId?: string;
  /** Filter by step ID (for step events) */
  stepId?: string;
  /** Custom predicate */
  predicate?: (event: Event) => boolean;
}

/** A registered subscription */
export interface Subscription {
  id: string;
  filter: EventFilter;
  handler: EventHandler;
  once: boolean;
}

/** Bus statistics */
export interface BusStats {
  totalPublished: number;
  totalDelivered: number;
  totalDropped: number;
  subscriptionCount: number;
  eventCounts: Record<string, number>;
}

/**
 * Pub/sub event bus for Continuum run events.
 */
export class EventBus {
  private subscriptions = new Map<string, Subscription>();
  private nextId = 1;
  private stats: BusStats = {
    totalPublished: 0,
    totalDelivered: 0,
    totalDropped: 0,
    subscriptionCount: 0,
    eventCounts: {},
  };
  private history: Event[] = [];
  private maxHistory: number;

  constructor(options?: { maxHistory?: number }) {
    this.maxHistory = options?.maxHistory ?? 1000;
  }

  /**
   * Subscribe to events matching a filter.
   */
  on(filter: EventFilter, handler: EventHandler): string {
    const id = `sub-${this.nextId++}`;
    this.subscriptions.set(id, { id, filter, handler, once: false });
    this.stats.subscriptionCount = this.subscriptions.size;
    return id;
  }

  /**
   * Subscribe to a specific event type.
   */
  onType<T extends Event>(type: T['type'], handler: EventHandler<T>): string {
    return this.on({ types: [type] }, handler as EventHandler);
  }

  /**
   * Subscribe once — handler is removed after first matching event.
   */
  once(filter: EventFilter, handler: EventHandler): string {
    const id = `sub-${this.nextId++}`;
    this.subscriptions.set(id, { id, filter, handler, once: true });
    this.stats.subscriptionCount = this.subscriptions.size;
    return id;
  }

  /**
   * Subscribe once to a specific event type.
   */
  onceType<T extends Event>(type: T['type'], handler: EventHandler<T>): string {
    return this.once({ types: [type] }, handler as EventHandler);
  }

  /**
   * Unsubscribe by subscription ID.
   */
  off(subscriptionId: string): boolean {
    const removed = this.subscriptions.delete(subscriptionId);
    this.stats.subscriptionCount = this.subscriptions.size;
    return removed;
  }

  /**
   * Publish an event to all matching subscribers.
   */
  async publish(event: Event): Promise<number> {
    this.stats.totalPublished++;
    this.stats.eventCounts[event.type] = (this.stats.eventCounts[event.type] ?? 0) + 1;

    // Store history
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    let delivered = 0;
    const toRemove: string[] = [];

    for (const [id, sub] of this.subscriptions) {
      if (matchesFilter(event, sub.filter)) {
        try {
          await sub.handler(event);
          delivered++;
        } catch {
          // Swallow handler errors
        }
        if (sub.once) {
          toRemove.push(id);
        }
      }
    }

    for (const id of toRemove) {
      this.subscriptions.delete(id);
    }
    this.stats.subscriptionCount = this.subscriptions.size;

    this.stats.totalDelivered += delivered;
    if (delivered === 0) this.stats.totalDropped++;

    return delivered;
  }

  /**
   * Publish synchronously (fire-and-forget).
   */
  emit(event: Event): void {
    void this.publish(event);
  }

  /**
   * Wait for a specific event type.
   */
  waitFor<T extends Event>(type: T['type'], timeoutMs?: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const subId = this.onceType<T>(type, (event) => {
        if (timer) clearTimeout(timer);
        resolve(event);
      });

      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.off(subId);
          reject(new Error(`Timeout waiting for event: ${type}`));
        }, timeoutMs);
      }
    });
  }

  /**
   * Get event history.
   */
  getHistory(filter?: EventFilter): Event[] {
    if (!filter) return [...this.history];
    return this.history.filter((e) => matchesFilter(e, filter));
  }

  /**
   * Get bus statistics.
   */
  getStats(): BusStats {
    return { ...this.stats, eventCounts: { ...this.stats.eventCounts } };
  }

  /**
   * Remove all subscriptions and clear history.
   */
  reset(): void {
    this.subscriptions.clear();
    this.history = [];
    this.stats = {
      totalPublished: 0,
      totalDelivered: 0,
      totalDropped: 0,
      subscriptionCount: 0,
      eventCounts: {},
    };
  }

  /**
   * Get subscriber count.
   */
  get subscriberCount(): number {
    return this.subscriptions.size;
  }
}

// ── Internal ──

function matchesFilter(event: Event, filter: EventFilter): boolean {
  if (filter.types && filter.types.length > 0) {
    if (!filter.types.includes(event.type)) return false;
  }

  if (filter.runId && event.run_id !== filter.runId) return false;

  if (filter.stepId) {
    if ('step_id' in event && (event as { step_id: string }).step_id !== filter.stepId) return false;
    if (!('step_id' in event)) return false;
  }

  if (filter.predicate && !filter.predicate(event)) return false;

  return true;
}

/** Create a global shared event bus instance. */
export function createEventBus(options?: { maxHistory?: number }): EventBus {
  return new EventBus(options);
}
