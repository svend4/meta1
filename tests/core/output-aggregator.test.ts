import { describe, it, expect } from 'vitest';
import {
  aggregateOutputs,
  computeSummary,
  groupOutputs,
  formatAggregation,
} from '../../src/core/output-aggregator.js';
import type { StepOutput } from '../../src/core/output-aggregator.js';

const outputs: StepOutput[] = [
  { stepId: 's1', output: 'hello', exitCode: 0, durationMs: 100, timestamp: '2024-01-01T00:00:01Z' },
  { stepId: 's2', output: 'world', exitCode: 0, durationMs: 200, timestamp: '2024-01-01T00:00:02Z' },
  { stepId: 's3', output: 'error!', exitCode: 1, durationMs: 50, timestamp: '2024-01-01T00:00:00Z' },
];

describe('aggregateOutputs', () => {
  it('concatenates with default separator', () => {
    const result = aggregateOutputs(outputs);
    expect(result.aggregatedOutput).toContain('hello');
    expect(result.aggregatedOutput).toContain('world');
    expect(result.strategy).toBe('concat');
    expect(result.inputCount).toBe(3);
  });

  it('concatenates with custom separator', () => {
    const result = aggregateOutputs(outputs, { strategy: 'concat', separator: ' | ' });
    expect(result.aggregatedOutput).toContain(' | ');
  });

  it('includes metadata when requested', () => {
    const result = aggregateOutputs(outputs, { strategy: 'concat', includeMetadata: true });
    expect(result.aggregatedOutput).toContain('s1');
    expect(result.aggregatedOutput).toContain('exit:');
  });

  it('merges JSON outputs', () => {
    const jsonOutputs: StepOutput[] = [
      { stepId: 's1', output: '{"a": 1}', exitCode: 0, durationMs: 10, timestamp: '2024-01-01T00:00:00Z' },
      { stepId: 's2', output: '{"b": 2}', exitCode: 0, durationMs: 10, timestamp: '2024-01-01T00:00:01Z' },
    ];

    const result = aggregateOutputs(jsonOutputs, { strategy: 'merge-json' });
    const parsed = JSON.parse(result.aggregatedOutput);
    expect(parsed.a).toBe(1);
    expect(parsed.b).toBe(2);
  });

  it('merge-json handles non-JSON gracefully', () => {
    const mixed: StepOutput[] = [
      { stepId: 's1', output: '{"a": 1}', exitCode: 0, durationMs: 10, timestamp: '2024-01-01T00:00:00Z' },
      { stepId: 's2', output: 'not json', exitCode: 0, durationMs: 10, timestamp: '2024-01-01T00:00:01Z' },
    ];

    const result = aggregateOutputs(mixed, { strategy: 'merge-json' });
    const parsed = JSON.parse(result.aggregatedOutput);
    expect(parsed.a).toBe(1);
    expect(parsed.s2).toBe('not json');
  });

  it('deduplicates lines', () => {
    const dupes: StepOutput[] = [
      { stepId: 's1', output: 'line1\nline2', exitCode: 0, durationMs: 10, timestamp: '2024-01-01T00:00:00Z' },
      { stepId: 's2', output: 'line2\nline3', exitCode: 0, durationMs: 10, timestamp: '2024-01-01T00:00:01Z' },
    ];

    const result = aggregateOutputs(dupes, { strategy: 'dedupe-lines' });
    expect(result.aggregatedOutput.split('\n')).toEqual(['line1', 'line2', 'line3']);
  });

  it('last-wins strategy', () => {
    const result = aggregateOutputs(outputs, { strategy: 'last-wins', sort: 'by-time' });
    expect(result.aggregatedOutput).toBe('world');
  });

  it('first-wins strategy', () => {
    const result = aggregateOutputs(outputs, { strategy: 'first-wins', sort: 'by-time' });
    expect(result.aggregatedOutput).toBe('error!');
  });

  it('custom reducer', () => {
    const result = aggregateOutputs(outputs, {
      strategy: 'custom',
      reducer: (outs) => outs.map((o) => o.output.toUpperCase()).join(','),
    });
    expect(result.aggregatedOutput).toContain('HELLO');
  });

  it('sorts by time', () => {
    const result = aggregateOutputs(outputs, { strategy: 'concat', sort: 'by-time', separator: '|' });
    // s3 first (00:00:00), s1 second (00:00:01), s2 last (00:00:02)
    expect(result.aggregatedOutput).toBe('error!|hello|world');
  });

  it('sorts by duration', () => {
    const result = aggregateOutputs(outputs, { strategy: 'concat', sort: 'by-duration', separator: '|' });
    // s3 first (50ms), s1 second (100ms), s2 last (200ms)
    expect(result.aggregatedOutput).toBe('error!|hello|world');
  });

  it('handles empty outputs', () => {
    const result = aggregateOutputs([]);
    expect(result.aggregatedOutput).toBe('');
    expect(result.inputCount).toBe(0);
  });
});

describe('computeSummary', () => {
  it('computes correct stats', () => {
    const summary = computeSummary(outputs);
    expect(summary.totalSteps).toBe(3);
    expect(summary.successfulSteps).toBe(2);
    expect(summary.failedSteps).toBe(1);
    expect(summary.longestStep?.stepId).toBe('s2');
    expect(summary.shortestStep?.stepId).toBe('s3');
    expect(summary.averageDurationMs).toBeGreaterThan(0);
  });

  it('handles empty outputs', () => {
    const summary = computeSummary([]);
    expect(summary.totalSteps).toBe(0);
    expect(summary.longestStep).toBeNull();
  });
});

describe('groupOutputs', () => {
  it('groups by exit code', () => {
    const groups = groupOutputs(outputs, 'exit-code');
    expect(groups.get('0')).toHaveLength(2);
    expect(groups.get('1')).toHaveLength(1);
  });

  it('groups by status', () => {
    const groups = groupOutputs(outputs, 'status');
    expect(groups.get('success')).toHaveLength(2);
    expect(groups.get('failure')).toHaveLength(1);
  });

  it('groups by custom function', () => {
    const groups = groupOutputs(outputs, (o) => o.output.length > 5 ? 'long' : 'short');
    expect(groups.has('long')).toBe(true);
    expect(groups.has('short')).toBe(true);
  });
});

describe('formatAggregation', () => {
  it('formats result', () => {
    const result = aggregateOutputs(outputs);
    const output = formatAggregation(result);
    expect(output).toContain('concat');
    expect(output).toContain('3 steps');
  });
});
