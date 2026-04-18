import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  saveRunSummary,
  loadRunSummary,
  listRunIds,
  listRunSummaries,
  runExists,
} from '../../src/storage/runs.js';
import * as paths from '../../src/core/paths.js';
import { vi } from 'vitest';
import type { RunSummary } from '../../src/types/run-summary.js';

let tempDir: string;

function makeSummary(runId: string, prompt: string): RunSummary {
  return {
    run_id: runId,
    task_id: 'task-1',
    prompt,
    status: 'completed',
    started_at: new Date().toISOString(),
    plan: {
      plan_id: 'plan-1',
      steps: [
        {
          step_id: 's1',
          type: 'create_file',
          description: 'Create file',
          path: 'test.txt',
          content: 'hello',
          determinism: 'guaranteed',
        },
      ],
    },
    plan_hash: 'sha256:abc',
    plan_source: 'llm',
    steps: [
      {
        step_id: 's1',
        type: 'create_file',
        status: 'completed',
        artifact_hash: 'sha256:def',
      },
    ],
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-test-'));
  vi.spyOn(paths, 'getRunsDir').mockReturnValue(join(tempDir, 'runs'));
  vi.spyOn(paths, 'getRunDir').mockImplementation((id) =>
    join(tempDir, 'runs', id),
  );
  vi.spyOn(paths, 'getSummaryPath').mockImplementation((id) =>
    join(tempDir, 'runs', id, 'summary.json'),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('runs storage', () => {
  it('saves and loads a run summary', () => {
    const summary = makeSummary('run-001', 'build api');
    saveRunSummary(summary);
    const loaded = loadRunSummary('run-001');
    expect(loaded.run_id).toBe('run-001');
    expect(loaded.prompt).toBe('build api');
  });

  it('throws when loading non-existent run', () => {
    expect(() => loadRunSummary('nonexistent')).toThrow('Run summary not found');
  });

  it('lists run IDs', () => {
    saveRunSummary(makeSummary('run-a', 'a'));
    saveRunSummary(makeSummary('run-b', 'b'));
    const ids = listRunIds();
    expect(ids).toContain('run-a');
    expect(ids).toContain('run-b');
  });

  it('returns empty list when no runs exist', () => {
    expect(listRunIds()).toEqual([]);
  });

  it('lists run summaries sorted by start time', () => {
    const s1 = makeSummary('run-1', 'first');
    s1.started_at = '2025-01-01T00:00:00.000Z';
    const s2 = makeSummary('run-2', 'second');
    s2.started_at = '2025-01-02T00:00:00.000Z';
    saveRunSummary(s2);
    saveRunSummary(s1);
    const summaries = listRunSummaries();
    expect(summaries[0].run_id).toBe('run-1');
    expect(summaries[1].run_id).toBe('run-2');
  });

  it('runExists returns correct values', () => {
    expect(runExists('nope')).toBe(false);
    saveRunSummary(makeSummary('run-x', 'x'));
    expect(runExists('run-x')).toBe(true);
  });
});
