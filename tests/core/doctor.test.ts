import { describe, it, expect } from 'vitest';
import { runDoctor } from '../../src/core/doctor.js';
import type { DoctorReport } from '../../src/core/doctor.js';

describe('runDoctor', () => {
  it('returns a report with all checks', () => {
    const report = runDoctor();

    expect(report.checks).toBeDefined();
    expect(report.checks.length).toBeGreaterThanOrEqual(5);
    expect(report.passed).toBeGreaterThanOrEqual(0);
    expect(report.warnings).toBeGreaterThanOrEqual(0);
    expect(report.failed).toBeGreaterThanOrEqual(0);
    expect(report.passed + report.warnings + report.failed).toBe(report.checks.length);
  });

  it('checks Node.js version', () => {
    const report = runDoctor();
    const nodeCheck = report.checks.find((c) => c.name === 'Node.js version');

    expect(nodeCheck).toBeDefined();
    expect(nodeCheck!.status).toBe('ok'); // CI should have Node >= 20
    expect(nodeCheck!.message).toContain('v');
  });

  it('checks storage directory', () => {
    const report = runDoctor();
    const storageCheck = report.checks.find((c) => c.name === 'Storage directory');

    expect(storageCheck).toBeDefined();
    expect(['ok', 'warn']).toContain(storageCheck!.status);
  });

  it('checks configuration', () => {
    const report = runDoctor();
    const configCheck = report.checks.find((c) => c.name === 'Configuration');

    expect(configCheck).toBeDefined();
    // May be warn (no config file) or ok (config found)
    expect(['ok', 'warn']).toContain(configCheck!.status);
  });

  it('checks plan cache', () => {
    const report = runDoctor();
    const cacheCheck = report.checks.find((c) => c.name === 'Plan cache');

    expect(cacheCheck).toBeDefined();
    expect(['ok', 'warn']).toContain(cacheCheck!.status);
  });

  it('checks run history', () => {
    const report = runDoctor();
    const historyCheck = report.checks.find((c) => c.name === 'Run history');

    expect(historyCheck).toBeDefined();
    expect(['ok', 'warn']).toContain(historyCheck!.status);
  });

  it('checks Docker availability', () => {
    const report = runDoctor();
    const dockerCheck = report.checks.find((c) => c.name === 'Docker');

    expect(dockerCheck).toBeDefined();
    // Docker may or may not be installed
    expect(['ok', 'warn']).toContain(dockerCheck!.status);
  });

  it('checks API key', () => {
    const report = runDoctor();
    const apiCheck = report.checks.find((c) => c.name === 'API key');

    expect(apiCheck).toBeDefined();
    // API key may or may not be set
    expect(['ok', 'warn']).toContain(apiCheck!.status);
  });

  it('report totals are consistent', () => {
    const report = runDoctor();
    const total = report.passed + report.warnings + report.failed;
    expect(total).toBe(report.checks.length);
  });
});
