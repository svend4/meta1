import { describe, it, expect, vi } from 'vitest';
import { diffWorkspaces, formatWorkspaceDiff } from '../../src/core/workspace-diff.js';
import type { RunSummary } from '../../src/types/run-summary.js';

vi.mock('../../src/storage/runs.js', () => ({
  loadRunSummary: vi.fn(),
}));

import { loadRunSummary } from '../../src/storage/runs.js';
const mockLoad = vi.mocked(loadRunSummary);

function makeRun(files: Array<{ path: string; content: string }>, overrides?: Partial<RunSummary>): RunSummary {
  return {
    run_id: 'run-1',
    task_id: 'task-1',
    prompt: 'test',
    status: 'completed',
    started_at: '2026-01-01T00:00:00Z',
    plan_hash: 'sha256:abc',
    plan_source: 'llm',
    plan: {
      plan_id: 'p1',
      steps: files.map((f, i) => ({
        step_id: `s${i}`,
        type: 'create_file',
        description: `Create ${f.path}`,
        path: f.path,
        content: f.content,
        determinism: 'guaranteed',
      })),
    },
    steps: files.map((f, i) => ({
      step_id: `s${i}`,
      type: 'create_file',
      status: 'completed',
    })),
    ...overrides,
  } as RunSummary;
}

describe('diffWorkspaces', () => {
  it('detects added files', () => {
    const runA = makeRun([{ path: 'a.ts', content: 'hello' }], { run_id: 'a' });
    const runB = makeRun([
      { path: 'a.ts', content: 'hello' },
      { path: 'b.ts', content: 'world' },
    ], { run_id: 'b' });

    mockLoad.mockImplementation((id) => id === 'a' ? runA : runB);

    const diff = diffWorkspaces('a', 'b');
    expect(diff.summary.added).toBe(1);
    expect(diff.files.find((f) => f.path === 'b.ts')?.status).toBe('added');
  });

  it('detects removed files', () => {
    const runA = makeRun([
      { path: 'a.ts', content: 'hello' },
      { path: 'b.ts', content: 'world' },
    ], { run_id: 'a' });
    const runB = makeRun([{ path: 'a.ts', content: 'hello' }], { run_id: 'b' });

    mockLoad.mockImplementation((id) => id === 'a' ? runA : runB);

    const diff = diffWorkspaces('a', 'b');
    expect(diff.summary.removed).toBe(1);
  });

  it('detects modified files', () => {
    const runA = makeRun([{ path: 'a.ts', content: 'version 1' }], { run_id: 'a' });
    const runB = makeRun([{ path: 'a.ts', content: 'version 2' }], { run_id: 'b' });

    mockLoad.mockImplementation((id) => id === 'a' ? runA : runB);

    const diff = diffWorkspaces('a', 'b');
    expect(diff.summary.modified).toBe(1);
    expect(diff.files[0].lineDiff).toBeDefined();
  });

  it('detects unchanged files', () => {
    const runA = makeRun([{ path: 'a.ts', content: 'same' }], { run_id: 'a' });
    const runB = makeRun([{ path: 'a.ts', content: 'same' }], { run_id: 'b' });

    mockLoad.mockImplementation((id) => id === 'a' ? runA : runB);

    const diff = diffWorkspaces('a', 'b');
    expect(diff.summary.unchanged).toBe(1);
  });

  it('excludes failed steps', () => {
    const runA = makeRun([{ path: 'a.ts', content: 'ok' }], { run_id: 'a' });
    const runB = makeRun([{ path: 'a.ts', content: 'ok' }], {
      run_id: 'b',
      steps: [{ step_id: 's0', type: 'create_file', status: 'failed' }],
    });

    mockLoad.mockImplementation((id) => id === 'a' ? runA : runB);

    const diff = diffWorkspaces('a', 'b');
    // RunB has no completed file steps, so a.ts is removed
    expect(diff.summary.removed).toBe(1);
  });

  it('formats diff output', () => {
    const runA = makeRun([{ path: 'a.ts', content: 'v1' }], { run_id: 'a' });
    const runB = makeRun([{ path: 'a.ts', content: 'v2' }], { run_id: 'b' });
    mockLoad.mockImplementation((id) => id === 'a' ? runA : runB);

    const diff = diffWorkspaces('a', 'b');
    const output = formatWorkspaceDiff(diff);
    expect(output).toContain('Workspace Diff');
    expect(output).toContain('Modified: 1');
  });

  it('formats diff with content', () => {
    const runA = makeRun([{ path: 'a.ts', content: 'line1\nline2' }], { run_id: 'a' });
    const runB = makeRun([{ path: 'a.ts', content: 'line1\nLINE2' }], { run_id: 'b' });
    mockLoad.mockImplementation((id) => id === 'a' ? runA : runB);

    const diff = diffWorkspaces('a', 'b');
    const output = formatWorkspaceDiff(diff, { showContent: true });
    expect(output).toContain('+');
    expect(output).toContain('-');
  });
});
