import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportRuns } from '../../src/core/export.js';
import type { RunSummary } from '../../src/types/run-summary.js';

vi.mock('../../src/storage/runs.js', () => ({
  listRunSummaries: vi.fn(),
  loadRunSummary: vi.fn(),
}));

import { listRunSummaries, loadRunSummary } from '../../src/storage/runs.js';
const mockList = vi.mocked(listRunSummaries);
const mockLoad = vi.mocked(loadRunSummary);

function makeRun(overrides?: Partial<RunSummary>): RunSummary {
  return {
    run_id: 'run-export-1',
    task_id: 'task-1',
    prompt: 'test',
    status: 'completed',
    started_at: '2026-01-15T10:00:00Z',
    completed_at: '2026-01-15T10:00:05Z',
    duration_ms: 5000,
    plan: { plan_id: 'p1', steps: [] },
    plan_hash: 'sha256:abc',
    plan_source: 'llm',
    steps: [
      { step_id: 's1', type: 'create_file', status: 'completed', duration_ms: 100 },
      { step_id: 's2', type: 'run_command', status: 'failed', duration_ms: 200, error: 'boom' },
    ],
    ...overrides,
  } as RunSummary;
}

describe('exportRuns', () => {
  beforeEach(() => {
    mockList.mockReturnValue([makeRun()]);
  });

  describe('markdown', () => {
    it('exports markdown with header', () => {
      const md = exportRuns('markdown');
      expect(md).toContain('# Continuum Runtime Report');
      expect(md).toContain('run-expo');
      expect(md).toContain('**completed**');
    });

    it('includes step details by default', () => {
      const md = exportRuns('markdown');
      expect(md).toContain('## Step Details');
      expect(md).toContain('s1');
      expect(md).toContain('s2');
      expect(md).toContain('boom');
    });

    it('omits steps when includeSteps is false', () => {
      const md = exportRuns('markdown', { includeSteps: false });
      expect(md).not.toContain('## Step Details');
    });
  });

  describe('csv', () => {
    it('exports CSV with header row', () => {
      const csv = exportRuns('csv');
      const lines = csv.split('\n');
      expect(lines[0]).toContain('run_id,task_id,status');
      expect(lines).toHaveLength(2); // header + 1 row
    });

    it('includes step counts', () => {
      const csv = exportRuns('csv');
      expect(csv).toContain('run-export-1');
      expect(csv).toContain('completed');
    });
  });

  describe('html', () => {
    it('exports valid HTML', () => {
      const html = exportRuns('html');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Continuum Runtime Report');
      expect(html).toContain('</html>');
    });

    it('includes run data', () => {
      const html = exportRuns('html');
      expect(html).toContain('run-expo');
      expect(html).toContain('task-1');
      expect(html).toContain('completed');
    });

    it('includes step rows', () => {
      const html = exportRuns('html');
      expect(html).toContain('s1');
      expect(html).toContain('s2');
    });
  });

  describe('filters', () => {
    it('filters by status', () => {
      mockList.mockReturnValue([
        makeRun({ run_id: 'r1', status: 'completed' }),
        makeRun({ run_id: 'r2', status: 'failed' }),
      ]);

      const md = exportRuns('markdown', { status: 'failed' });
      expect(md).toContain('r2');
      expect(md).not.toContain('r1');
    });

    it('filters by date range', () => {
      mockList.mockReturnValue([
        makeRun({ run_id: 'r1', started_at: '2026-01-01T00:00:00Z' }),
        makeRun({ run_id: 'r2', started_at: '2026-02-01T00:00:00Z' }),
      ]);

      const md = exportRuns('markdown', { since: '2026-01-15T00:00:00Z' });
      expect(md).not.toContain('`r1');
      expect(md).toContain('r2');
    });

    it('exports specific run IDs', () => {
      mockLoad.mockReturnValue(makeRun({ run_id: 'specific-run' }));

      const md = exportRuns('markdown', { runIds: ['specific-run'] });
      expect(md).toContain('specific');
    });
  });
});
