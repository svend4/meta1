/**
 * Step breakpoints — pause execution before specified steps,
 * allowing inspection of state and control over continuation.
 *
 * This is a programmatic breakpoint system (not interactive TTY).
 * Consumers provide a handler that decides what to do at each breakpoint.
 */

import type { Step } from '../types/execution-plan.js';
import type { StepResult } from '../types/run-summary.js';

/** Action to take at a breakpoint */
export type BreakpointAction = 'continue' | 'skip' | 'abort';

/** State available at a breakpoint */
export interface BreakpointState {
  /** The step about to execute */
  step: Step;
  /** Index of the step in the plan */
  stepIndex: number;
  /** Total steps in the plan */
  totalSteps: number;
  /** Results of previously completed steps */
  completedResults: StepResult[];
  /** Steps that were skipped */
  skippedStepIds: string[];
  /** Elapsed time since run start (ms) */
  elapsedMs: number;
  /** Current workspace path */
  workspace?: string;
}

/** Handler function called at each breakpoint */
export type BreakpointHandler = (state: BreakpointState) => BreakpointAction | Promise<BreakpointAction>;

/** Breakpoint configuration */
export interface BreakpointConfig {
  /** Step IDs to break on. If empty, breaks on every step. */
  stepIds?: string[];
  /** Break on steps matching a type */
  stepType?: 'create_file' | 'run_command';
  /** Break only on steps with specific determinism */
  determinism?: 'guaranteed' | 'best_effort';
  /** Break on the Nth step (0-indexed) */
  atIndex?: number;
  /** Break before the first failed step (in replay/re-run scenarios) */
  beforeFailure?: boolean;
  /** Handler called at each breakpoint */
  handler: BreakpointHandler;
}

/**
 * Breakpoint manager that tracks active breakpoints and evaluates
 * whether to pause at each step.
 */
export class BreakpointManager {
  private configs: BreakpointConfig[] = [];
  private failedStepIds = new Set<string>();

  constructor(configs?: BreakpointConfig[]) {
    if (configs) {
      this.configs = configs;
    }
  }

  /** Add a breakpoint configuration */
  addBreakpoint(config: BreakpointConfig): void {
    this.configs.push(config);
  }

  /** Set known failed step IDs (for beforeFailure breakpoints) */
  setFailedSteps(stepIds: string[]): void {
    this.failedStepIds = new Set(stepIds);
  }

  /** Check if any breakpoint matches this step */
  shouldBreak(state: BreakpointState): BreakpointConfig | null {
    for (const config of this.configs) {
      if (this.matches(config, state)) {
        return config;
      }
    }
    return null;
  }

  /**
   * Evaluate breakpoints for a step. Returns the action to take.
   * If no breakpoint matches, returns 'continue'.
   */
  async evaluate(state: BreakpointState): Promise<BreakpointAction> {
    const config = this.shouldBreak(state);
    if (!config) return 'continue';

    return config.handler(state);
  }

  /** Get all active breakpoint configurations */
  getBreakpoints(): BreakpointConfig[] {
    return [...this.configs];
  }

  /** Remove all breakpoints */
  clearBreakpoints(): void {
    this.configs = [];
  }

  /** Remove breakpoints for a specific step */
  removeBreakpoint(stepId: string): boolean {
    const before = this.configs.length;
    this.configs = this.configs.filter(
      (c) => !c.stepIds?.includes(stepId),
    );
    return this.configs.length < before;
  }

  private matches(config: BreakpointConfig, state: BreakpointState): boolean {
    // Match by step ID
    if (config.stepIds && config.stepIds.length > 0) {
      if (!config.stepIds.includes(state.step.step_id)) return false;
    }

    // Match by step type
    if (config.stepType && state.step.type !== config.stepType) {
      return false;
    }

    // Match by determinism
    if (config.determinism && state.step.determinism !== config.determinism) {
      return false;
    }

    // Match by index
    if (config.atIndex !== undefined && state.stepIndex !== config.atIndex) {
      return false;
    }

    // Match before known failure
    if (config.beforeFailure) {
      if (!this.failedStepIds.has(state.step.step_id)) return false;
    }

    return true;
  }
}

/**
 * Create a simple logging breakpoint handler (for non-interactive use).
 */
export function createLoggingHandler(
  callback?: (state: BreakpointState) => void,
): BreakpointHandler {
  return (state) => {
    if (callback) callback(state);
    return 'continue';
  };
}

/**
 * Create a handler that always skips the target step.
 */
export function createSkipHandler(): BreakpointHandler {
  return () => 'skip';
}

/**
 * Create a handler that aborts execution at the breakpoint.
 */
export function createAbortHandler(): BreakpointHandler {
  return () => 'abort';
}

/**
 * Format breakpoint state for display.
 */
export function formatBreakpointState(state: BreakpointState): string {
  const lines: string[] = [];

  lines.push(`Breakpoint: step ${state.stepIndex + 1}/${state.totalSteps}`);
  lines.push(`  Step: ${state.step.step_id} (${state.step.type})`);
  lines.push(`  Description: ${state.step.description}`);
  lines.push(`  Determinism: ${state.step.determinism}`);
  lines.push(`  Elapsed: ${state.elapsedMs}ms`);
  lines.push(`  Completed: ${state.completedResults.length}`);
  lines.push(`  Skipped: ${state.skippedStepIds.length}`);

  if (state.step.depends_on?.length) {
    lines.push(`  Depends on: ${state.step.depends_on.join(', ')}`);
  }

  return lines.join('\n');
}
