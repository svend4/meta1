/**
 * Step timeout manager — per-step timeouts with configurable actions
 * (kill, warn, skip), grace periods, timeout escalation, and metrics.
 */

/** Action to take when a step times out */
export type TimeoutAction = 'kill' | 'warn' | 'skip';

/** Timeout escalation stage */
export interface EscalationStage {
  afterMs: number;
  action: TimeoutAction;
  message?: string;
}

/** Per-step timeout configuration */
export interface StepTimeoutConfig {
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Action on timeout. Default: 'kill' */
  action: TimeoutAction;
  /** Grace period before escalation (ms). Default: 0 */
  gracePeriodMs: number;
  /** Escalation stages (warn → kill progression) */
  escalation: EscalationStage[];
}

/** Record of a timeout event */
export interface TimeoutRecord {
  stepId: string;
  configuredMs: number;
  elapsedMs: number;
  action: TimeoutAction;
  escalationLevel: number;
  timestamp: string;
}

/** Timeout manager statistics */
export interface TimeoutStats {
  totalMonitored: number;
  totalTimedOut: number;
  totalWarnings: number;
  totalKills: number;
  totalSkips: number;
  records: TimeoutRecord[];
}

/** Callback for timeout actions */
export type TimeoutCallback = (record: TimeoutRecord) => void | Promise<void>;

/**
 * Step timeout manager. Monitors step execution and applies
 * timeout policies with escalation.
 */
export class TimeoutManager {
  private stats: TimeoutStats = {
    totalMonitored: 0,
    totalTimedOut: 0,
    totalWarnings: 0,
    totalKills: 0,
    totalSkips: 0,
    records: [],
  };

  private activeTimers = new Map<string, ReturnType<typeof setTimeout>[]>();
  private onTimeout?: TimeoutCallback;

  constructor(options?: { onTimeout?: TimeoutCallback }) {
    this.onTimeout = options?.onTimeout;
  }

  /**
   * Monitor a step promise with timeout configuration.
   * Returns the step result, a 'skipped' sentinel, or throws on kill.
   */
  async monitor<T>(
    stepId: string,
    config: StepTimeoutConfig,
    execute: () => Promise<T>,
  ): Promise<{ result: T; timedOut: false } | { result: undefined; timedOut: true; action: TimeoutAction }> {
    this.stats.totalMonitored++;
    const startTime = Date.now();
    const timers: ReturnType<typeof setTimeout>[] = [];
    this.activeTimers.set(stepId, timers);

    let resolved = false;
    let escalationLevel = 0;

    return new Promise<{ result: T; timedOut: false } | { result: undefined; timedOut: true; action: TimeoutAction }>((resolve, reject) => {
      // Set up escalation timers
      for (const stage of config.escalation) {
        const timer = setTimeout(() => {
          if (resolved) return;
          escalationLevel++;

          const record: TimeoutRecord = {
            stepId,
            configuredMs: stage.afterMs,
            elapsedMs: Date.now() - startTime,
            action: stage.action,
            escalationLevel,
            timestamp: new Date().toISOString(),
          };

          this.recordTimeout(record);

          if (stage.action === 'kill') {
            resolved = true;
            this.clearTimers(stepId);
            resolve({ result: undefined, timedOut: true, action: 'kill' });
          } else if (stage.action === 'skip') {
            resolved = true;
            this.clearTimers(stepId);
            resolve({ result: undefined, timedOut: true, action: 'skip' });
          }
          // 'warn' action: just record, don't stop execution
        }, stage.afterMs);
        timers.push(timer);
      }

      // Set up main timeout (with grace period)
      const totalTimeout = config.timeoutMs + config.gracePeriodMs;
      const mainTimer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        this.clearTimers(stepId);

        const record: TimeoutRecord = {
          stepId,
          configuredMs: config.timeoutMs,
          elapsedMs: Date.now() - startTime,
          action: config.action,
          escalationLevel: escalationLevel + 1,
          timestamp: new Date().toISOString(),
        };
        this.recordTimeout(record);

        if (config.action === 'kill') {
          resolve({ result: undefined, timedOut: true, action: 'kill' });
        } else if (config.action === 'skip') {
          resolve({ result: undefined, timedOut: true, action: 'skip' });
        } else {
          // warn: still resolve with timeout
          resolve({ result: undefined, timedOut: true, action: 'warn' });
        }
      }, totalTimeout);
      timers.push(mainTimer);

      // Execute the step
      execute()
        .then((result) => {
          if (!resolved) {
            resolved = true;
            this.clearTimers(stepId);
            resolve({ result, timedOut: false });
          }
        })
        .catch((err) => {
          if (!resolved) {
            resolved = true;
            this.clearTimers(stepId);
            reject(err);
          }
        });
    });
  }

  /**
   * Cancel monitoring for a step.
   */
  cancel(stepId: string): void {
    this.clearTimers(stepId);
  }

  /**
   * Get timeout statistics.
   */
  getStats(): TimeoutStats {
    return { ...this.stats, records: [...this.stats.records] };
  }

  /**
   * Get timeout records for a specific step.
   */
  getRecords(stepId: string): TimeoutRecord[] {
    return this.stats.records.filter((r) => r.stepId === stepId);
  }

  /**
   * Reset all state.
   */
  reset(): void {
    for (const [id] of this.activeTimers) {
      this.clearTimers(id);
    }
    this.stats = {
      totalMonitored: 0,
      totalTimedOut: 0,
      totalWarnings: 0,
      totalKills: 0,
      totalSkips: 0,
      records: [],
    };
  }

  // ── Internal ──

  private clearTimers(stepId: string): void {
    const timers = this.activeTimers.get(stepId);
    if (timers) {
      for (const t of timers) clearTimeout(t);
      this.activeTimers.delete(stepId);
    }
  }

  private recordTimeout(record: TimeoutRecord): void {
    this.stats.totalTimedOut++;
    this.stats.records.push(record);

    switch (record.action) {
      case 'warn': this.stats.totalWarnings++; break;
      case 'kill': this.stats.totalKills++; break;
      case 'skip': this.stats.totalSkips++; break;
    }

    if (this.onTimeout) {
      void Promise.resolve(this.onTimeout(record));
    }
  }
}

/**
 * Create a default timeout config.
 */
export function defaultTimeoutConfig(timeoutMs: number): StepTimeoutConfig {
  return {
    timeoutMs,
    action: 'kill',
    gracePeriodMs: 0,
    escalation: [],
  };
}

/**
 * Create a timeout config with warn → kill escalation.
 */
export function escalatingTimeoutConfig(timeoutMs: number): StepTimeoutConfig {
  return {
    timeoutMs,
    action: 'kill',
    gracePeriodMs: Math.round(timeoutMs * 0.1),
    escalation: [
      { afterMs: Math.round(timeoutMs * 0.8), action: 'warn', message: 'Step approaching timeout' },
    ],
  };
}

/**
 * Format timeout stats for display.
 */
export function formatTimeoutStats(stats: TimeoutStats): string {
  const lines: string[] = [];
  lines.push(`Timeout Stats: ${stats.totalMonitored} monitored, ${stats.totalTimedOut} timed out`);
  lines.push(`  Warnings: ${stats.totalWarnings}, Kills: ${stats.totalKills}, Skips: ${stats.totalSkips}`);

  if (stats.records.length > 0) {
    lines.push('  Records:');
    for (const r of stats.records) {
      lines.push(`    ${r.stepId}: ${r.action} at ${r.elapsedMs}ms (configured: ${r.configuredMs}ms)`);
    }
  }

  return lines.join('\n');
}
