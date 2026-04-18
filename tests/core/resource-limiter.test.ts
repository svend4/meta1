import { describe, it, expect } from 'vitest';
import { ResourceLimiter } from '../../src/core/resource-limiter.js';

describe('ResourceLimiter', () => {
  it('allows operations when no limits', () => {
    const limiter = new ResourceLimiter();
    expect(limiter.checkFileWrite(1024).allowed).toBe(true);
    expect(limiter.checkCommand().allowed).toBe(true);
  });

  it('enforces concurrent file write limit', async () => {
    const limiter = new ResourceLimiter({ maxConcurrentFileWrites: 2 });

    await limiter.acquireFileWrite(100);
    await limiter.acquireFileWrite(100);

    const check = limiter.checkFileWrite(100);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('Concurrent file write limit');

    limiter.releaseFileWrite();
    expect(limiter.checkFileWrite(100).allowed).toBe(true);
  });

  it('enforces concurrent command limit', async () => {
    const limiter = new ResourceLimiter({ maxConcurrentCommands: 1 });

    await limiter.acquireCommand();
    expect(limiter.checkCommand().allowed).toBe(false);

    limiter.releaseCommand();
    expect(limiter.checkCommand().allowed).toBe(true);
  });

  it('enforces disk write budget', () => {
    const limiter = new ResourceLimiter({ maxDiskWriteBytes: 1000 });

    expect(limiter.checkFileWrite(500).allowed).toBe(true);
    expect(limiter.checkFileWrite(1500).allowed).toBe(false);
  });

  it('tracks disk write budget across writes', async () => {
    const limiter = new ResourceLimiter({ maxDiskWriteBytes: 1000 });

    await limiter.acquireFileWrite(600);
    limiter.releaseFileWrite();

    const check = limiter.checkFileWrite(500);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('Disk write budget exceeded');
  });

  it('warns at soft limit', () => {
    const limiter = new ResourceLimiter({
      maxDiskWriteBytes: 1000,
      softLimitRatio: 0.5,
    });

    // Track 600 bytes
    limiter['totalDiskWriteBytes'] = 600;

    const check = limiter.checkCommand();
    expect(check.allowed).toBe(true);
    expect(check.warning).toContain('Disk writes at');
  });

  it('reports usage', () => {
    const limiter = new ResourceLimiter();
    const usage = limiter.getUsage();

    expect(usage.activeFileWrites).toBe(0);
    expect(usage.activeCommands).toBe(0);
    expect(usage.memoryBytes).toBeGreaterThan(0);
    expect(usage.diskWriteBytes).toBe(0);
  });

  it('resets counters', async () => {
    const limiter = new ResourceLimiter();
    await limiter.acquireFileWrite(100);
    await limiter.acquireCommand();

    limiter.reset();

    const usage = limiter.getUsage();
    expect(usage.activeFileWrites).toBe(0);
    expect(usage.activeCommands).toBe(0);
    expect(usage.diskWriteBytes).toBe(0);
  });

  it('updates limits', () => {
    const limiter = new ResourceLimiter({ maxConcurrentCommands: 5 });
    limiter.updateLimits({ maxConcurrentCommands: 10 });
    expect(limiter.getLimits().maxConcurrentCommands).toBe(10);
  });

  it('formats usage', () => {
    const limiter = new ResourceLimiter({
      maxConcurrentFileWrites: 5,
      maxConcurrentCommands: 3,
    });
    const output = limiter.formatUsage();
    expect(output).toContain('Resource Usage');
    expect(output).toContain('File writes');
    expect(output).toContain('Commands');
  });

  it('does not go negative on release', () => {
    const limiter = new ResourceLimiter();
    limiter.releaseFileWrite();
    limiter.releaseCommand();

    expect(limiter.getUsage().activeFileWrites).toBe(0);
    expect(limiter.getUsage().activeCommands).toBe(0);
  });

  it('waits for slot when limit reached', async () => {
    const limiter = new ResourceLimiter({ maxConcurrentCommands: 1 });
    await limiter.acquireCommand();

    let acquired = false;
    const waitPromise = limiter.acquireCommand().then(() => { acquired = true; });

    // Not acquired yet
    expect(acquired).toBe(false);

    // Release slot
    limiter.releaseCommand();
    await waitPromise;
    expect(acquired).toBe(true);
  });
});
