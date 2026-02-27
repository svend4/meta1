import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchRuns } from '../../src/core/search.js';
import type { RunSummary } from '../../src/types/run-summary.js';

vi.mock('../../src/storage/runs.js', () => ({
  listRunSummaries: vi.fn(),
}));

import { listRunSummaries } from '../../src/storage/runs.js';
const mockListRuns = vi.mocked(listRunSummaries);

function makeRun(overrides: Partial<RunSummary>): RunSummary {
  return {
    run_id: 'run-1',
    task_id: 'task-1',
    prompt: 'Build API',
    status: 'completed',
    started_at: '2026-01-01T00:00:00Z',
    plan: { plan_id: 'p1', steps: [] },
    plan_hash: 'sha256:abc',
    plan_source: 'llm',
    steps: [],
    ...overrides,
  } as RunSummary;
}

describe('searchRuns', () => {
  beforeEach(() => {
    mockListRuns.mockReturnValue([
      makeRun({
        run_id: 'r1',
        prompt: 'Build Express API with health endpoint',
        steps: [
          { step_id: 'create-index', type: 'create_file', status: 'completed', description: 'Create main file' },
          { step_id: 'npm-install', type: 'run_command', status: 'completed', stdout: 'added 50 packages' },
        ],
      }),
      makeRun({
        run_id: 'r2',
        prompt: 'Fix database connection bug',
        status: 'failed',
        steps: [
          { step_id: 'run-test', type: 'run_command', status: 'failed', error: 'Connection refused to port 5432', stderr: 'ECONNREFUSED' },
        ],
      }),
      makeRun({
        run_id: 'r3',
        prompt: 'Deploy to production',
        steps: [
          { step_id: 'deploy', type: 'run_command', status: 'completed', description: 'Deploy to cloud' },
        ],
      }),
    ]);
  });

  it('searches in prompt', () => {
    const results = searchRuns({ query: 'Express' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchField).toBe('prompt');
  });

  it('searches in step errors', () => {
    const results = searchRuns({ query: 'Connection refused' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchField).toContain('error');
  });

  it('searches in step stdout', () => {
    const results = searchRuns({ query: 'added 50 packages' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchField).toContain('stdout');
  });

  it('searches in step stderr', () => {
    const results = searchRuns({ query: 'ECONNREFUSED' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchField).toContain('stderr');
  });

  it('searches in step descriptions', () => {
    const results = searchRuns({ query: 'Deploy to cloud' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchField).toContain('description');
  });

  it('case insensitive by default', () => {
    const results = searchRuns({ query: 'express' });
    expect(results.length).toBeGreaterThan(0);
  });

  it('case sensitive when requested', () => {
    const results = searchRuns({ query: 'express', caseSensitive: true });
    expect(results).toHaveLength(0);
  });

  it('limits results', () => {
    const results = searchRuns({ query: 'e', limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('filters by specific fields', () => {
    const results = searchRuns({ query: 'Express', fields: ['error'] });
    expect(results).toHaveLength(0);
  });

  it('returns empty for no match', () => {
    const results = searchRuns({ query: 'nonexistent-xyz-12345' });
    expect(results).toHaveLength(0);
  });

  it('provides match context', () => {
    const results = searchRuns({ query: 'Connection refused' });
    expect(results[0].matchContext).toContain('Connection refused');
  });
});
