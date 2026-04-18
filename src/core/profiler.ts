/**
 * Step profiler that captures memory and CPU usage per step.
 * Uses process.memoryUsage() and process.cpuUsage() for metrics.
 */

/** Resource snapshot at a point in time */
export interface ResourceSnapshot {
  /** Heap memory used in bytes */
  heapUsedBytes: number;
  /** Total heap allocated in bytes */
  heapTotalBytes: number;
  /** Resident set size in bytes */
  rssBytes: number;
  /** External memory in bytes (C++ objects bound to JS) */
  externalBytes: number;
  /** CPU user time in microseconds */
  cpuUserUs: number;
  /** CPU system time in microseconds */
  cpuSystemUs: number;
  /** Timestamp */
  timestamp: string;
}

/** Profile data for a single step */
export interface StepProfile {
  step_id: string;
  /** Snapshot before step execution */
  before: ResourceSnapshot;
  /** Snapshot after step execution */
  after: ResourceSnapshot;
  /** Delta values */
  delta: {
    heapUsedBytes: number;
    rssBytes: number;
    cpuUserUs: number;
    cpuSystemUs: number;
    wallTimeMs: number;
  };
  /** Peak memory observed during step (if sampling was enabled) */
  peakRssBytes?: number;
}

/** Full profile for a run */
export interface RunProfile {
  run_id: string;
  steps: StepProfile[];
  /** Aggregate stats across all steps */
  summary: {
    peakRssBytes: number;
    totalCpuUserUs: number;
    totalCpuSystemUs: number;
    totalWallTimeMs: number;
    avgHeapDeltaBytes: number;
  };
}

/**
 * Capture a resource snapshot at the current moment.
 */
export function captureSnapshot(): ResourceSnapshot {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();

  return {
    heapUsedBytes: mem.heapUsed,
    heapTotalBytes: mem.heapTotal,
    rssBytes: mem.rss,
    externalBytes: mem.external,
    cpuUserUs: cpu.user,
    cpuSystemUs: cpu.system,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Step profiler that wraps step execution and records resource usage.
 */
export class StepProfiler {
  private profiles: StepProfile[] = [];
  private activeStep: { stepId: string; before: ResourceSnapshot; startTime: number; peakRss: number; sampler?: ReturnType<typeof setInterval> } | null = null;

  /**
   * Start profiling a step. Call before step execution.
   */
  begin(stepId: string, sampleIntervalMs?: number): void {
    const before = captureSnapshot();
    const active: typeof this.activeStep = {
      stepId,
      before,
      startTime: Date.now(),
      peakRss: before.rssBytes,
    };

    // Optional memory sampling during execution
    if (sampleIntervalMs && sampleIntervalMs > 0) {
      active.sampler = setInterval(() => {
        const mem = process.memoryUsage();
        if (mem.rss > active!.peakRss) {
          active!.peakRss = mem.rss;
        }
      }, sampleIntervalMs);
    }

    this.activeStep = active;
  }

  /**
   * End profiling for the current step. Call after step execution.
   */
  end(): StepProfile {
    if (!this.activeStep) {
      throw new Error('No active step profiling session');
    }

    const { stepId, before, startTime, peakRss, sampler } = this.activeStep;

    if (sampler) {
      clearInterval(sampler);
    }

    const after = captureSnapshot();
    const wallTimeMs = Date.now() - startTime;

    // Check peak one more time
    const finalPeakRss = Math.max(peakRss, after.rssBytes);

    const profile: StepProfile = {
      step_id: stepId,
      before,
      after,
      delta: {
        heapUsedBytes: after.heapUsedBytes - before.heapUsedBytes,
        rssBytes: after.rssBytes - before.rssBytes,
        cpuUserUs: after.cpuUserUs - before.cpuUserUs,
        cpuSystemUs: after.cpuSystemUs - before.cpuSystemUs,
        wallTimeMs,
      },
      peakRssBytes: finalPeakRss,
    };

    this.profiles.push(profile);
    this.activeStep = null;

    return profile;
  }

  /**
   * Get all collected profiles.
   */
  getProfiles(): StepProfile[] {
    return [...this.profiles];
  }

  /**
   * Build a full run profile with summary statistics.
   */
  buildRunProfile(runId: string): RunProfile {
    const steps = this.getProfiles();

    const peakRssBytes = steps.length > 0
      ? Math.max(...steps.map((s) => s.peakRssBytes ?? s.after.rssBytes))
      : 0;

    const totalCpuUserUs = steps.reduce((s, p) => s + p.delta.cpuUserUs, 0);
    const totalCpuSystemUs = steps.reduce((s, p) => s + p.delta.cpuSystemUs, 0);
    const totalWallTimeMs = steps.reduce((s, p) => s + p.delta.wallTimeMs, 0);
    const avgHeapDeltaBytes = steps.length > 0
      ? Math.round(steps.reduce((s, p) => s + p.delta.heapUsedBytes, 0) / steps.length)
      : 0;

    return {
      run_id: runId,
      steps,
      summary: {
        peakRssBytes,
        totalCpuUserUs,
        totalCpuSystemUs,
        totalWallTimeMs,
        avgHeapDeltaBytes,
      },
    };
  }
}

/**
 * Format a run profile for human-readable output.
 */
export function formatProfile(profile: RunProfile): string {
  const lines: string[] = [];

  lines.push(`Profile: ${profile.run_id}`);
  lines.push('');
  lines.push('  Summary:');
  lines.push(`    Peak RSS: ${formatBytes(profile.summary.peakRssBytes)}`);
  lines.push(`    CPU user: ${formatUs(profile.summary.totalCpuUserUs)}`);
  lines.push(`    CPU system: ${formatUs(profile.summary.totalCpuSystemUs)}`);
  lines.push(`    Wall time: ${profile.summary.totalWallTimeMs}ms`);
  lines.push(`    Avg heap delta: ${formatBytes(profile.summary.avgHeapDeltaBytes)}`);
  lines.push('');

  if (profile.steps.length > 0) {
    const maxIdLen = Math.max(7, ...profile.steps.map((s) => s.step_id.length));

    lines.push(`  ${'Step'.padEnd(maxIdLen)}  ${'Wall'.padStart(8)}  ${'CPU'.padStart(8)}  ${'Heap Δ'.padStart(10)}  ${'Peak RSS'.padStart(10)}`);
    lines.push(`  ${'─'.repeat(maxIdLen)}  ${'─'.repeat(8)}  ${'─'.repeat(8)}  ${'─'.repeat(10)}  ${'─'.repeat(10)}`);

    for (const s of profile.steps) {
      lines.push(
        `  ${s.step_id.padEnd(maxIdLen)}  ${(s.delta.wallTimeMs + 'ms').padStart(8)}  ${formatUs(s.delta.cpuUserUs).padStart(8)}  ${formatBytes(s.delta.heapUsedBytes).padStart(10)}  ${formatBytes(s.peakRssBytes ?? 0).padStart(10)}`,
      );
    }
  }

  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  const abs = Math.abs(bytes);
  const sign = bytes < 0 ? '-' : '';
  if (abs < 1024) return `${sign}${abs}B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(1)}KB`;
  return `${sign}${(abs / (1024 * 1024)).toFixed(1)}MB`;
}

function formatUs(us: number): string {
  if (us < 1000) return `${us}μs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(1)}ms`;
  return `${(us / 1_000_000).toFixed(2)}s`;
}
