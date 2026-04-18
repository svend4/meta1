import { describe, it, expect } from 'vitest';
import { StepProfiler, captureSnapshot, formatProfile } from '../../src/core/profiler.js';

describe('captureSnapshot', () => {
  it('captures memory and CPU values', () => {
    const snap = captureSnapshot();
    expect(snap.heapUsedBytes).toBeGreaterThan(0);
    expect(snap.heapTotalBytes).toBeGreaterThan(0);
    expect(snap.rssBytes).toBeGreaterThan(0);
    expect(snap.cpuUserUs).toBeGreaterThanOrEqual(0);
    expect(snap.cpuSystemUs).toBeGreaterThanOrEqual(0);
    expect(snap.timestamp).toBeTruthy();
  });
});

describe('StepProfiler', () => {
  it('profiles a step', async () => {
    const profiler = new StepProfiler();

    profiler.begin('step-1');
    // Do some work
    const arr = Array.from({ length: 10000 }, (_, i) => i * i);
    const _sum = arr.reduce((a, b) => a + b, 0);
    const profile = profiler.end();

    expect(profile.step_id).toBe('step-1');
    expect(profile.before).toBeDefined();
    expect(profile.after).toBeDefined();
    expect(profile.delta.wallTimeMs).toBeGreaterThanOrEqual(0);
    expect(profile.delta.cpuUserUs).toBeGreaterThanOrEqual(0);
  });

  it('collects multiple profiles', () => {
    const profiler = new StepProfiler();

    profiler.begin('s1');
    profiler.end();

    profiler.begin('s2');
    profiler.end();

    const profiles = profiler.getProfiles();
    expect(profiles).toHaveLength(2);
    expect(profiles[0].step_id).toBe('s1');
    expect(profiles[1].step_id).toBe('s2');
  });

  it('throws when ending without beginning', () => {
    const profiler = new StepProfiler();
    expect(() => profiler.end()).toThrow('No active step profiling session');
  });

  it('builds run profile with summary', () => {
    const profiler = new StepProfiler();

    profiler.begin('s1');
    profiler.end();

    profiler.begin('s2');
    profiler.end();

    const runProfile = profiler.buildRunProfile('run-test');
    expect(runProfile.run_id).toBe('run-test');
    expect(runProfile.steps).toHaveLength(2);
    expect(runProfile.summary.peakRssBytes).toBeGreaterThan(0);
    expect(runProfile.summary.totalCpuUserUs).toBeGreaterThanOrEqual(0);
    expect(runProfile.summary.totalWallTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('profiles with memory sampling', async () => {
    const profiler = new StepProfiler();

    profiler.begin('sampled', 10);
    await new Promise((r) => setTimeout(r, 50));
    const profile = profiler.end();

    expect(profile.peakRssBytes).toBeGreaterThan(0);
  });
});

describe('formatProfile', () => {
  it('produces readable output', () => {
    const profiler = new StepProfiler();
    profiler.begin('step-fmt');
    profiler.end();

    const runProfile = profiler.buildRunProfile('run-fmt');
    const output = formatProfile(runProfile);

    expect(output).toContain('Profile: run-fmt');
    expect(output).toContain('Summary:');
    expect(output).toContain('Peak RSS:');
    expect(output).toContain('step-fmt');
  });
});
