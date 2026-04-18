import type { ExecutionPlan } from '../types/execution-plan.js';
import type { RunSummary, StepResult } from '../types/run-summary.js';
import type { Step } from '../types/execution-plan.js';

/** Plugin lifecycle hooks */
export interface ContinuumPlugin {
  /** Plugin name (must be unique) */
  name: string;

  /** Called before plan generation or loading. Can modify the prompt. */
  onBeforePlan?: (context: BeforePlanContext) => void | Promise<void>;

  /** Called after plan is acquired. Can inspect or transform the plan. */
  onAfterPlan?: (context: AfterPlanContext) => void | Promise<void>;

  /** Called before each step executes. Can modify step or skip it. */
  onBeforeStep?: (context: BeforeStepContext) => void | Promise<void>;

  /** Called after each step completes (success or failure). */
  onAfterStep?: (context: AfterStepContext) => void | Promise<void>;

  /** Called after the run completes. Can inspect the summary. */
  onRunComplete?: (summary: RunSummary) => void | Promise<void>;
}

export interface BeforePlanContext {
  prompt: string;
  taskId: string;
  runId: string;
}

export interface AfterPlanContext {
  plan: ExecutionPlan;
  source: 'llm' | 'cache' | 'file';
  runId: string;
}

export interface BeforeStepContext {
  step: Step;
  stepIndex: number;
  runId: string;
  /** Set to true to skip this step */
  skip: boolean;
}

export interface AfterStepContext {
  step: Step;
  result: StepResult;
  stepIndex: number;
  runId: string;
}

/**
 * Plugin registry. Manages registration and invocation of plugins.
 */
export class PluginRegistry {
  private plugins: ContinuumPlugin[] = [];

  /** Register a plugin. Throws if a plugin with the same name is already registered. */
  register(plugin: ContinuumPlugin): void {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    this.plugins.push(plugin);
  }

  /** Unregister a plugin by name. Returns true if removed. */
  unregister(name: string): boolean {
    const idx = this.plugins.findIndex((p) => p.name === name);
    if (idx === -1) return false;
    this.plugins.splice(idx, 1);
    return true;
  }

  /** List registered plugin names. */
  list(): string[] {
    return this.plugins.map((p) => p.name);
  }

  /** Get the number of registered plugins. */
  get size(): number {
    return this.plugins.length;
  }

  /** Invoke onBeforePlan hooks for all plugins. */
  async beforePlan(context: BeforePlanContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onBeforePlan) {
        await plugin.onBeforePlan(context);
      }
    }
  }

  /** Invoke onAfterPlan hooks for all plugins. */
  async afterPlan(context: AfterPlanContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onAfterPlan) {
        await plugin.onAfterPlan(context);
      }
    }
  }

  /** Invoke onBeforeStep hooks for all plugins. Returns the context (may have skip=true). */
  async beforeStep(context: BeforeStepContext): Promise<BeforeStepContext> {
    for (const plugin of this.plugins) {
      if (plugin.onBeforeStep) {
        await plugin.onBeforeStep(context);
        if (context.skip) break;
      }
    }
    return context;
  }

  /** Invoke onAfterStep hooks for all plugins. */
  async afterStep(context: AfterStepContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onAfterStep) {
        await plugin.onAfterStep(context);
      }
    }
  }

  /** Invoke onRunComplete hooks for all plugins. */
  async runComplete(summary: RunSummary): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onRunComplete) {
        await plugin.onRunComplete(summary);
      }
    }
  }

  /** Clear all registered plugins. */
  clear(): void {
    this.plugins = [];
  }
}

/** Global plugin registry */
export const globalRegistry = new PluginRegistry();
