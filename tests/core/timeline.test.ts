import { describe, it, expect } from 'vitest';
import { buildTimeline, formatTimeline } from '../../src/core/timeline.js';
import type { RunSummary } from '../../src/types/run-summary.js';

function makeRun(overrides: Partial<RunSummary>): RunSummary {
  return {
    run_id: 'run-timeline-test',
    task_id: 'task-1',
    prompt: 'test',
    status: 'completed',
    started_at: '2026-01-01T00:00:00Z',
    duration_ms: 10000,
    plan: { plan_id: 'p1', steps: [] },
    plan_hash: 'sha256:abc',
    plan_source: 'llm',
    steps: [],
    ...overrides,
  } as RunSummary;
}

describe('buildTimeline', () => {
  it('builds sequential timeline', () => {
    const run = makeRun({
      plan: { plan_id: 'p1', steps: [
        { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
        { step_id: 's2', type: 'run_command', description: '', command: 'echo', args: [], determinism: 'best_effort' },
      ]},
      steps: [
        { step_id: 's1', type: 'create_file', status: 'completed', duration_ms: 100 },
        { step_id: 's2', type: 'run_command', status: 'completed', duration_ms: 200 },
      ],
    });

    const tl = buildTimeline(run);
    expect(tl.entries).toHaveLength(2);
    expect(tl.entries[0].startMs).toBe(0);
    expect(tl.entries[0].endMs).toBe(100);
    expect(tl.entries[1].startMs).toBe(100);
    expect(tl.entries[1].endMs).toBe(300);
    expect(tl.totalDurationMs).toBe(300);
  });

  it('builds parallel timeline respecting deps', () => {
    const run = makeRun({
      plan: {
        plan_id: 'p1',
        execution_mode: 'parallel',
        steps: [
          { step_id: 's1', type: 'create_file', description: '', path: 'a', content: '', determinism: 'guaranteed' },
          { step_id: 's2', type: 'create_file', description: '', path: 'b', content: '', determinism: 'guaranteed' },
          { step_id: 's3', type: 'run_command', description: '', command: 'echo', args: [], determinism: 'best_effort', depends_on: ['s1', 's2'] },
        ],
      },
      steps: [
        { step_id: 's1', type: 'create_file', status: 'completed', duration_ms: 100 },
        { step_id: 's2', type: 'create_file', status: 'completed', duration_ms: 200 },
        { step_id: 's3', type: 'run_command', status: 'completed', duration_ms: 50 },
      ],
    });

    const tl = buildTimeline(run);
    expect(tl.entries).toHaveLength(3);

    // s1 and s2 start at 0 (no deps)
    expect(tl.entries[0].startMs).toBe(0);
    expect(tl.entries[1].startMs).toBe(0);

    // s3 starts after both s1 and s2 complete (max(100, 200) = 200)
    expect(tl.entries[2].startMs).toBe(200);
    expect(tl.entries[2].endMs).toBe(250);

    expect(tl.totalDurationMs).toBe(250);
  });

  it('handles empty run', () => {
    const run = makeRun({ steps: [] });
    const tl = buildTimeline(run);
    expect(tl.entries).toHaveLength(0);
    expect(tl.totalDurationMs).toBe(0);
  });

  it('handles skipped steps with no duration', () => {
    const run = makeRun({
      steps: [
        { step_id: 's1', type: 'create_file', status: 'completed', duration_ms: 100 },
        { step_id: 's2', type: 'run_command', status: 'skipped' },
      ],
    });

    const tl = buildTimeline(run);
    expect(tl.entries[1].durationMs).toBe(0);
    expect(tl.entries[1].status).toBe('skipped');
  });
});

describe('formatTimeline', () => {
  it('renders ASCII Gantt chart', () => {
    const run = makeRun({
      steps: [
        { step_id: 's1', type: 'create_file', status: 'completed', duration_ms: 500 },
        { step_id: 's2', type: 'run_command', status: 'failed', duration_ms: 300 },
      ],
    });

    const tl = buildTimeline(run);
    const output = formatTimeline(tl, 40);

    expect(output).toContain('Timeline:');
    expect(output).toContain('s1');
    expect(output).toContain('s2');
    expect(output).toContain('█');  // completed
    expect(output).toContain('░');  // failed
    expect(output).toContain('Legend');
  });

  it('renders with custom width', () => {
    const run = makeRun({
      steps: [
        { step_id: 's1', type: 'create_file', status: 'completed', duration_ms: 1000 },
      ],
    });

    const tl = buildTimeline(run);
    const output = formatTimeline(tl, 80);
    expect(output).toContain('Timeline:');
  });
});
