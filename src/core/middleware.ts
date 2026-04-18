/**
 * Step middleware — intercept step lifecycle with chainable handlers
 * that can transform step data, wrap execution, and handle errors.
 *
 * Middleware run in pipeline order: before hooks fire left→right,
 * after hooks fire right→left (like Express/Koa middleware).
 */

import type { Step } from '../types/execution-plan.js';
import type { StepResult } from '../types/run-summary.js';

/** Context passed through the middleware pipeline */
export interface MiddlewareContext {
  /** The step being executed (mutable — middleware can transform it) */
  step: Step;
  /** Index in plan */
  stepIndex: number;
  /** Resolved environment variables for the step */
  env: Record<string, string>;
  /** Metadata bag for middleware to share data */
  metadata: Record<string, unknown>;
  /** Result of step execution (available in after/error phases) */
  result?: StepResult;
  /** Error if step failed (available in error phase) */
  error?: Error;
  /** Set to true to skip execution of this step */
  skip: boolean;
  /** Elapsed time since run start (ms) */
  elapsedMs: number;
}

/** Middleware hook phases */
export interface StepMiddleware {
  /** Unique name for this middleware */
  name: string;
  /** Called before step execution. Can modify step/env/skip. */
  before?: (ctx: MiddlewareContext) => void | Promise<void>;
  /** Called after successful step execution. Can inspect/transform result. */
  after?: (ctx: MiddlewareContext) => void | Promise<void>;
  /** Called when step fails. Can modify error handling. */
  onError?: (ctx: MiddlewareContext) => void | Promise<void>;
  /** Priority (lower = runs first in before, last in after). Default: 100. */
  priority?: number;
}

/**
 * Middleware pipeline that manages ordered execution of step middleware.
 */
export class MiddlewarePipeline {
  private middleware: StepMiddleware[] = [];

  /** Register a middleware */
  use(mw: StepMiddleware): this {
    this.middleware.push(mw);
    this.middleware.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    return this;
  }

  /** Remove a middleware by name */
  remove(name: string): boolean {
    const before = this.middleware.length;
    this.middleware = this.middleware.filter((m) => m.name !== name);
    return this.middleware.length < before;
  }

  /** Get all registered middleware names */
  list(): string[] {
    return this.middleware.map((m) => m.name);
  }

  /** Clear all middleware */
  clear(): void {
    this.middleware = [];
  }

  /** Run the before phase (left→right order) */
  async runBefore(ctx: MiddlewareContext): Promise<void> {
    for (const mw of this.middleware) {
      if (ctx.skip) break;
      if (mw.before) {
        await mw.before(ctx);
      }
    }
  }

  /** Run the after phase (right→left order) */
  async runAfter(ctx: MiddlewareContext): Promise<void> {
    for (let i = this.middleware.length - 1; i >= 0; i--) {
      const mw = this.middleware[i];
      if (mw.after) {
        await mw.after(ctx);
      }
    }
  }

  /** Run the error phase (right→left order) */
  async runError(ctx: MiddlewareContext): Promise<void> {
    for (let i = this.middleware.length - 1; i >= 0; i--) {
      const mw = this.middleware[i];
      if (mw.onError) {
        await mw.onError(ctx);
      }
    }
  }
}

// ── Built-in middleware factories ──

/**
 * Logging middleware — logs step lifecycle events.
 */
export function createLoggingMiddleware(
  log: (msg: string) => void = console.log,
): StepMiddleware {
  return {
    name: 'logging',
    priority: 10,
    before: (ctx) => {
      log(`[middleware:logging] before step "${ctx.step.step_id}" (${ctx.step.type})`);
    },
    after: (ctx) => {
      log(`[middleware:logging] after step "${ctx.step.step_id}" — ${ctx.result?.status ?? 'unknown'}`);
    },
    onError: (ctx) => {
      log(`[middleware:logging] error in step "${ctx.step.step_id}": ${ctx.error?.message}`);
    },
  };
}

/**
 * Env injection middleware — merges additional env vars into step context.
 */
export function createEnvMiddleware(
  extraEnv: Record<string, string>,
): StepMiddleware {
  return {
    name: 'env-inject',
    priority: 20,
    before: (ctx) => {
      Object.assign(ctx.env, extraEnv);
    },
  };
}

/**
 * Timing middleware — records step execution duration in metadata.
 */
export function createTimingMiddleware(): StepMiddleware {
  return {
    name: 'timing',
    priority: 5,
    before: (ctx) => {
      ctx.metadata['timing:start'] = Date.now();
    },
    after: (ctx) => {
      const start = ctx.metadata['timing:start'] as number;
      ctx.metadata['timing:duration_ms'] = Date.now() - start;
    },
  };
}

/**
 * Skip middleware — skip steps matching a predicate.
 */
export function createSkipMiddleware(
  shouldSkip: (step: Step) => boolean,
): StepMiddleware {
  return {
    name: 'skip-filter',
    priority: 50,
    before: (ctx) => {
      if (shouldSkip(ctx.step)) {
        ctx.skip = true;
      }
    },
  };
}

/**
 * Create a middleware context for a step.
 */
export function createMiddlewareContext(
  step: Step,
  stepIndex: number,
  env: Record<string, string>,
  elapsedMs: number,
): MiddlewareContext {
  return {
    step: { ...step },
    stepIndex,
    env: { ...env },
    metadata: {},
    skip: false,
    elapsedMs,
  };
}
