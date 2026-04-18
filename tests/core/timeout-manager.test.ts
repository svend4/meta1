import { describe, it, expect } from 'vitest';
import {
  TimeoutManager,
  defaultTimeoutConfig,
  escalatingTimeoutConfig,
  formatTimeoutStats,
} from '../../src/core/timeout-manager.js';
import type { StepTimeoutConfig } from '../../src/core/timeout-manager.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('TimeoutManager', () => {
  it('completes before timeout', async () => {
    const mgr = new TimeoutManager();
    const config = defaultTimeoutConfig(1000);

    const result = await mgr.monitor('s1', config, async () => 'done');
    expect(result.timedOut).toBe(false);
    expect(result.result).toBe('done');
  });

  it('times out with kill action', async () => {
    const mgr = new TimeoutManager();
    const config = defaultTimeoutConfig(50);

    const result = await mgr.monitor('s1', config, () => sleep(200).then(() => 'late'));
    expect(result.timedOut).toBe(true);
    expect(result.action).toBe('kill');
  });

  it('times out with skip action', async () => {
    const mgr = new TimeoutManager();
    const config: StepTimeoutConfig = { timeoutMs: 50, action: 'skip', gracePeriodMs: 0, escalation: [] };

    const result = await mgr.monitor('s1', config, () => sleep(200).then(() => 'late'));
    expect(result.timedOut).toBe(true);
    expect(result.action).toBe('skip');
  });

  it('times out with warn action', async () => {
    const mgr = new TimeoutManager();
    const config: StepTimeoutConfig = { timeoutMs: 50, action: 'warn', gracePeriodMs: 0, escalation: [] };

    const result = await mgr.monitor('s1', config, () => sleep(200).then(() => 'late'));
    expect(result.timedOut).toBe(true);
    expect(result.action).toBe('warn');
  });

  it('respects grace period', async () => {
    const mgr = new TimeoutManager();
    const config: StepTimeoutConfig = { timeoutMs: 30, action: 'kill', gracePeriodMs: 50, escalation: [] };

    // Should complete within 30ms + 50ms grace = 80ms total
    const result = await mgr.monitor('s1', config, () => sleep(60).then(() => 'ok'));
    expect(result.timedOut).toBe(false);
    expect(result.result).toBe('ok');
  });

  it('fires escalation warn before kill', async () => {
    const mgr = new TimeoutManager();
    const config: StepTimeoutConfig = {
      timeoutMs: 150,
      action: 'kill',
      gracePeriodMs: 0,
      escalation: [
        { afterMs: 30, action: 'warn', message: 'Approaching timeout' },
      ],
    };

    await mgr.monitor('s1', config, () => sleep(300).then(() => 'late'));

    const stats = mgr.getStats();
    // Should have at least the warn + the kill
    expect(stats.totalWarnings).toBeGreaterThanOrEqual(1);
  });

  it('escalation kill stops execution', async () => {
    const mgr = new TimeoutManager();
    const config: StepTimeoutConfig = {
      timeoutMs: 5000,
      action: 'kill',
      gracePeriodMs: 0,
      escalation: [
        { afterMs: 30, action: 'kill' },
      ],
    };

    const result = await mgr.monitor('s1', config, () => sleep(300).then(() => 'late'));
    expect(result.timedOut).toBe(true);
    expect(result.action).toBe('kill');
  });

  it('tracks statistics', async () => {
    const mgr = new TimeoutManager();
    const config = defaultTimeoutConfig(30);

    await mgr.monitor('s1', config, () => sleep(100).then(() => 'late'));
    await mgr.monitor('s2', config, async () => 'fast');

    const stats = mgr.getStats();
    expect(stats.totalMonitored).toBe(2);
    expect(stats.totalTimedOut).toBeGreaterThanOrEqual(1);
  });

  it('gets records for specific step', async () => {
    const mgr = new TimeoutManager();
    const config = defaultTimeoutConfig(30);

    await mgr.monitor('s1', config, () => sleep(100).then(() => 'late'));

    const records = mgr.getRecords('s1');
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records[0].stepId).toBe('s1');
  });

  it('calls onTimeout callback', async () => {
    const records: string[] = [];
    const mgr = new TimeoutManager({
      onTimeout: (r) => { records.push(r.stepId); },
    });

    await mgr.monitor('s1', defaultTimeoutConfig(30), () => sleep(100).then(() => 'late'));
    expect(records).toContain('s1');
  });

  it('handles execution errors', async () => {
    const mgr = new TimeoutManager();
    const config = defaultTimeoutConfig(1000);

    await expect(
      mgr.monitor('s1', config, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
  });

  it('reset clears state', async () => {
    const mgr = new TimeoutManager();
    await mgr.monitor('s1', defaultTimeoutConfig(30), () => sleep(100).then(() => 'late'));

    mgr.reset();
    const stats = mgr.getStats();
    expect(stats.totalMonitored).toBe(0);
    expect(stats.records).toHaveLength(0);
  });
});

describe('defaultTimeoutConfig', () => {
  it('creates config with given timeout', () => {
    const config = defaultTimeoutConfig(5000);
    expect(config.timeoutMs).toBe(5000);
    expect(config.action).toBe('kill');
    expect(config.gracePeriodMs).toBe(0);
  });
});

describe('escalatingTimeoutConfig', () => {
  it('creates config with warn escalation', () => {
    const config = escalatingTimeoutConfig(10000);
    expect(config.timeoutMs).toBe(10000);
    expect(config.escalation).toHaveLength(1);
    expect(config.escalation[0].action).toBe('warn');
    expect(config.escalation[0].afterMs).toBe(8000); // 80%
    expect(config.gracePeriodMs).toBe(1000); // 10%
  });
});

describe('formatTimeoutStats', () => {
  it('formats stats', async () => {
    const mgr = new TimeoutManager();
    await mgr.monitor('s1', defaultTimeoutConfig(30), () => sleep(100).then(() => 'late'));

    const output = formatTimeoutStats(mgr.getStats());
    expect(output).toContain('Timeout Stats');
    expect(output).toContain('monitored');
  });
});
