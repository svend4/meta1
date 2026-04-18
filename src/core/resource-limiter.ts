/**
 * Resource limiter — enforce per-step and per-run resource budgets
 * for concurrent file writes, memory usage, and execution slots.
 */

/** Resource limit configuration */
export interface ResourceLimits {
  /** Max concurrent file write operations. Default: unlimited. */
  maxConcurrentFileWrites?: number;
  /** Max concurrent command executions. Default: unlimited. */
  maxConcurrentCommands?: number;
  /** Max memory usage in bytes (checked before each step). Default: unlimited. */
  maxMemoryBytes?: number;
  /** Max total disk writes in bytes for the entire run. Default: unlimited. */
  maxDiskWriteBytes?: number;
  /** Soft limit threshold (0-1). Triggers warning. Default: 0.8. */
  softLimitRatio?: number;
}

/** Current resource usage snapshot */
export interface ResourceUsage {
  activeFileWrites: number;
  activeCommands: number;
  memoryBytes: number;
  diskWriteBytes: number;
  timestamp: number;
}

/** Resource limit check result */
export interface LimitCheck {
  allowed: boolean;
  reason?: string;
  warning?: string;
  usage: ResourceUsage;
}

/**
 * Resource limiter that enforces budgets and tracks resource usage.
 */
export class ResourceLimiter {
  private limits: ResourceLimits;
  private activeFileWrites = 0;
  private activeCommands = 0;
  private totalDiskWriteBytes = 0;
  private waiters: Array<{ resolve: () => void; type: 'file' | 'command' }> = [];

  constructor(limits: ResourceLimits = {}) {
    this.limits = limits;
  }

  /** Get current resource usage */
  getUsage(): ResourceUsage {
    return {
      activeFileWrites: this.activeFileWrites,
      activeCommands: this.activeCommands,
      memoryBytes: process.memoryUsage().heapUsed,
      diskWriteBytes: this.totalDiskWriteBytes,
      timestamp: Date.now(),
    };
  }

  /** Check if a file write operation is allowed */
  checkFileWrite(sizeBytes: number): LimitCheck {
    const usage = this.getUsage();

    if (this.limits.maxDiskWriteBytes !== undefined) {
      if (this.totalDiskWriteBytes + sizeBytes > this.limits.maxDiskWriteBytes) {
        return {
          allowed: false,
          reason: `Disk write budget exceeded: ${formatBytes(this.totalDiskWriteBytes + sizeBytes)} > ${formatBytes(this.limits.maxDiskWriteBytes)}`,
          usage,
        };
      }
    }

    if (this.limits.maxConcurrentFileWrites !== undefined) {
      if (this.activeFileWrites >= this.limits.maxConcurrentFileWrites) {
        return {
          allowed: false,
          reason: `Concurrent file write limit reached: ${this.activeFileWrites}/${this.limits.maxConcurrentFileWrites}`,
          usage,
        };
      }
    }

    return this.checkSoftLimits(usage);
  }

  /** Check if a command execution is allowed */
  checkCommand(): LimitCheck {
    const usage = this.getUsage();

    if (this.limits.maxConcurrentCommands !== undefined) {
      if (this.activeCommands >= this.limits.maxConcurrentCommands) {
        return {
          allowed: false,
          reason: `Concurrent command limit reached: ${this.activeCommands}/${this.limits.maxConcurrentCommands}`,
          usage,
        };
      }
    }

    if (this.limits.maxMemoryBytes !== undefined) {
      if (usage.memoryBytes > this.limits.maxMemoryBytes) {
        return {
          allowed: false,
          reason: `Memory limit exceeded: ${formatBytes(usage.memoryBytes)} > ${formatBytes(this.limits.maxMemoryBytes)}`,
          usage,
        };
      }
    }

    return this.checkSoftLimits(usage);
  }

  /** Acquire a file write slot. Resolves when slot is available. */
  async acquireFileWrite(sizeBytes: number): Promise<void> {
    if (this.limits.maxConcurrentFileWrites !== undefined) {
      while (this.activeFileWrites >= this.limits.maxConcurrentFileWrites) {
        await new Promise<void>((resolve) => {
          this.waiters.push({ resolve, type: 'file' });
        });
      }
    }
    this.activeFileWrites++;
    this.totalDiskWriteBytes += sizeBytes;
  }

  /** Release a file write slot */
  releaseFileWrite(): void {
    this.activeFileWrites = Math.max(0, this.activeFileWrites - 1);
    this.drainWaiters('file');
  }

  /** Acquire a command execution slot */
  async acquireCommand(): Promise<void> {
    if (this.limits.maxConcurrentCommands !== undefined) {
      while (this.activeCommands >= this.limits.maxConcurrentCommands) {
        await new Promise<void>((resolve) => {
          this.waiters.push({ resolve, type: 'command' });
        });
      }
    }
    this.activeCommands++;
  }

  /** Release a command execution slot */
  releaseCommand(): void {
    this.activeCommands = Math.max(0, this.activeCommands - 1);
    this.drainWaiters('command');
  }

  /** Reset all counters */
  reset(): void {
    this.activeFileWrites = 0;
    this.activeCommands = 0;
    this.totalDiskWriteBytes = 0;
    for (const w of this.waiters) w.resolve();
    this.waiters = [];
  }

  /** Get configured limits */
  getLimits(): ResourceLimits {
    return { ...this.limits };
  }

  /** Update limits */
  updateLimits(limits: Partial<ResourceLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }

  /** Format resource usage for display */
  formatUsage(): string {
    const usage = this.getUsage();
    const lines: string[] = ['Resource Usage:'];

    lines.push(`  File writes: ${usage.activeFileWrites} active`);
    if (this.limits.maxConcurrentFileWrites !== undefined) {
      lines.push(`    Limit: ${this.limits.maxConcurrentFileWrites}`);
    }

    lines.push(`  Commands: ${usage.activeCommands} active`);
    if (this.limits.maxConcurrentCommands !== undefined) {
      lines.push(`    Limit: ${this.limits.maxConcurrentCommands}`);
    }

    lines.push(`  Memory: ${formatBytes(usage.memoryBytes)}`);
    if (this.limits.maxMemoryBytes !== undefined) {
      lines.push(`    Limit: ${formatBytes(this.limits.maxMemoryBytes)}`);
    }

    lines.push(`  Disk written: ${formatBytes(usage.diskWriteBytes)}`);
    if (this.limits.maxDiskWriteBytes !== undefined) {
      lines.push(`    Limit: ${formatBytes(this.limits.maxDiskWriteBytes)}`);
    }

    return lines.join('\n');
  }

  // ── Internal ──

  private checkSoftLimits(usage: ResourceUsage): LimitCheck {
    const ratio = this.limits.softLimitRatio ?? 0.8;
    let warning: string | undefined;

    if (this.limits.maxMemoryBytes !== undefined) {
      const pct = usage.memoryBytes / this.limits.maxMemoryBytes;
      if (pct >= ratio) {
        warning = `Memory usage at ${(pct * 100).toFixed(0)}% of limit`;
      }
    }

    if (this.limits.maxDiskWriteBytes !== undefined) {
      const pct = this.totalDiskWriteBytes / this.limits.maxDiskWriteBytes;
      if (pct >= ratio) {
        const msg = `Disk writes at ${(pct * 100).toFixed(0)}% of limit`;
        warning = warning ? `${warning}; ${msg}` : msg;
      }
    }

    return { allowed: true, warning, usage };
  }

  private drainWaiters(type: 'file' | 'command'): void {
    const idx = this.waiters.findIndex((w) => w.type === type);
    if (idx !== -1) {
      const [waiter] = this.waiters.splice(idx, 1);
      waiter.resolve();
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
