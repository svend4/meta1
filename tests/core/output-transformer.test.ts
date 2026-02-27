import { describe, it, expect, afterEach } from 'vitest';
import {
  applyTransformers,
  registerTransformer,
  unregisterTransformer,
  formatTransformResult,
} from '../../src/core/output-transformer.js';
import type { OutputTransformer } from '../../src/core/output-transformer.js';

describe('applyTransformers', () => {
  afterEach(() => {
    unregisterTransformer('upper');
  });

  it('applies json_extract', () => {
    const input = JSON.stringify({ data: { id: 42 } });
    const result = applyTransformers(input, [
      { type: 'json_extract', path: 'data.id' },
    ]);
    expect(result.success).toBe(true);
    expect(result.output).toBe('42');
  });

  it('extracts nested JSON string', () => {
    const input = JSON.stringify({ name: 'Alice' });
    const result = applyTransformers(input, [
      { type: 'json_extract', path: 'name' },
    ]);
    expect(result.output).toBe('Alice');
  });

  it('handles array indexing in json_extract', () => {
    const input = JSON.stringify({ items: ['a', 'b', 'c'] });
    const result = applyTransformers(input, [
      { type: 'json_extract', path: 'items[1]' },
    ]);
    expect(result.output).toBe('b');
  });

  it('applies regex extraction', () => {
    const result = applyTransformers('version: 1.2.3', [
      { type: 'regex', pattern: 'version: (\\d+\\.\\d+\\.\\d+)', group: 1 },
    ]);
    expect(result.success).toBe(true);
    expect(result.output).toBe('1.2.3');
  });

  it('applies regex with group 0', () => {
    const result = applyTransformers('hello world', [
      { type: 'regex', pattern: '\\w+ \\w+', group: 0 },
    ]);
    expect(result.output).toBe('hello world');
  });

  it('applies template', () => {
    const result = applyTransformers('42', [
      { type: 'template', template: 'The answer is {{input}}.' },
    ]);
    expect(result.output).toBe('The answer is 42.');
  });

  it('applies lines: first', () => {
    const result = applyTransformers('line1\nline2\nline3', [
      { type: 'lines', range: 'first' },
    ]);
    expect(result.output).toBe('line1');
  });

  it('applies lines: last', () => {
    const result = applyTransformers('line1\nline2\nline3', [
      { type: 'lines', range: 'last' },
    ]);
    expect(result.output).toBe('line3');
  });

  it('applies lines: range', () => {
    const result = applyTransformers('a\nb\nc\nd', [
      { type: 'lines', range: '2-3' },
    ]);
    expect(result.output).toBe('b\nc');
  });

  it('applies lines: single line number', () => {
    const result = applyTransformers('a\nb\nc', [
      { type: 'lines', range: '2' },
    ]);
    expect(result.output).toBe('b');
  });

  it('applies trim', () => {
    const result = applyTransformers('  hello  \n', [
      { type: 'trim' },
    ]);
    expect(result.output).toBe('hello');
  });

  it('chains transformers', () => {
    const input = JSON.stringify({ message: '  HELLO  ' });
    const result = applyTransformers(input, [
      { type: 'json_extract', path: 'message' },
      { type: 'trim' },
      { type: 'template', template: 'Msg: {{input}}' },
    ]);
    expect(result.success).toBe(true);
    expect(result.output).toBe('Msg: HELLO');
    expect(result.stages).toHaveLength(3);
  });

  it('stops on failure', () => {
    const result = applyTransformers('not json', [
      { type: 'json_extract', path: 'x' },
      { type: 'trim' },
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('json_extract');
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0].success).toBe(false);
  });

  it('reports regex mismatch', () => {
    const result = applyTransformers('no match here', [
      { type: 'regex', pattern: 'xyz(\\d+)' },
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('did not match');
  });

  it('applies custom transformer', () => {
    registerTransformer('upper', (s) => s.toUpperCase());

    const result = applyTransformers('hello', [
      { type: 'custom', name: 'upper' },
    ]);
    expect(result.output).toBe('HELLO');
  });

  it('fails for unregistered custom transformer', () => {
    const result = applyTransformers('x', [
      { type: 'custom', name: 'nonexistent' },
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not registered');
  });

  it('returns input unchanged for empty pipeline', () => {
    const result = applyTransformers('hello', []);
    expect(result.output).toBe('hello');
    expect(result.success).toBe(true);
  });
});

describe('registerTransformer / unregisterTransformer', () => {
  it('registers and unregisters', () => {
    registerTransformer('test', (s) => s);
    expect(unregisterTransformer('test')).toBe(true);
    expect(unregisterTransformer('test')).toBe(false);
  });
});

describe('formatTransformResult', () => {
  it('formats successful result', () => {
    const result = applyTransformers('hello', [{ type: 'trim' }]);
    const output = formatTransformResult(result);
    expect(output).toContain('Transform: OK');
    expect(output).toContain('Output: hello');
  });

  it('formats failed result', () => {
    const result = applyTransformers('x', [{ type: 'json_extract', path: 'a' }]);
    const output = formatTransformResult(result);
    expect(output).toContain('FAILED');
    expect(output).toContain('Error');
  });
});
