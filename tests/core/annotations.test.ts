import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  addAnnotation,
  loadAnnotations,
  getStepAnnotations,
  removeAnnotation,
  searchAnnotations,
} from '../../src/core/annotations.js';

let tempDir: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
}));

describe('annotations', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-annotations-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('adds and loads an annotation', () => {
    const ann = addAnnotation('run-1', 'step-1', 'This step is important');

    expect(ann.run_id).toBe('run-1');
    expect(ann.step_id).toBe('step-1');
    expect(ann.text).toBe('This step is important');
    expect(ann.id).toMatch(/^ann-/);

    const loaded = loadAnnotations('run-1');
    expect(loaded.annotations).toHaveLength(1);
    expect(loaded.annotations[0].text).toBe('This step is important');
  });

  it('supports tags and author', () => {
    const ann = addAnnotation('run-1', 'step-1', 'needs review', {
      tags: ['review', 'urgent'],
      author: 'alice',
    });

    expect(ann.tags).toEqual(['review', 'urgent']);
    expect(ann.author).toBe('alice');
  });

  it('adds multiple annotations', () => {
    addAnnotation('run-1', 'step-1', 'First note');
    addAnnotation('run-1', 'step-1', 'Second note');
    addAnnotation('run-1', 'step-2', 'Different step');

    const loaded = loadAnnotations('run-1');
    expect(loaded.annotations).toHaveLength(3);
  });

  it('gets annotations for specific step', () => {
    addAnnotation('run-1', 'step-1', 'Note A');
    addAnnotation('run-1', 'step-2', 'Note B');
    addAnnotation('run-1', 'step-1', 'Note C');

    const step1 = getStepAnnotations('run-1', 'step-1');
    expect(step1).toHaveLength(2);
    expect(step1[0].text).toBe('Note A');
    expect(step1[1].text).toBe('Note C');
  });

  it('returns empty for no annotations', () => {
    const loaded = loadAnnotations('nonexistent');
    expect(loaded.annotations).toHaveLength(0);
  });

  it('removes an annotation', () => {
    const ann = addAnnotation('run-1', 'step-1', 'Remove me');
    const removed = removeAnnotation('run-1', ann.id);
    expect(removed).toBe(true);

    const loaded = loadAnnotations('run-1');
    expect(loaded.annotations).toHaveLength(0);
  });

  it('returns false when removing nonexistent annotation', () => {
    expect(removeAnnotation('run-1', 'ghost-id')).toBe(false);
  });

  it('searches by text', () => {
    addAnnotation('run-1', 'step-1', 'Performance issue here');
    addAnnotation('run-1', 'step-2', 'Looks good');
    addAnnotation('run-1', 'step-3', 'Another performance problem');

    const results = searchAnnotations('run-1', { text: 'performance' });
    expect(results).toHaveLength(2);
  });

  it('searches by tag', () => {
    addAnnotation('run-1', 'step-1', 'Note A', { tags: ['bug'] });
    addAnnotation('run-1', 'step-2', 'Note B', { tags: ['feature'] });
    addAnnotation('run-1', 'step-3', 'Note C', { tags: ['bug', 'urgent'] });

    const results = searchAnnotations('run-1', { tag: 'bug' });
    expect(results).toHaveLength(2);
  });
});
