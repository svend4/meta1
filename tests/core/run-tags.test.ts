import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  tagRun,
  untagRun,
  getRunTags,
  getRunsByTag,
  listTags,
  deleteTag,
  renameTag,
} from '../../src/core/run-tags.js';

let tempDir: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
}));

vi.mock('../../src/storage/runs.js', () => ({
  runExists: (runId: string) => runId !== 'ghost',
}));

describe('run-tags', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-tags-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('tags a run', () => {
    tagRun('run-1', 'production');
    expect(getRunTags('run-1')).toEqual(['production']);
  });

  it('adds multiple tags', () => {
    tagRun('run-1', 'production');
    tagRun('run-1', 'stable');
    expect(getRunTags('run-1')).toEqual(['production', 'stable']);
  });

  it('tags multiple runs with same tag', () => {
    tagRun('run-1', 'v1');
    tagRun('run-2', 'v1');
    expect(getRunsByTag('v1')).toEqual(['run-1', 'run-2']);
  });

  it('prevents duplicate tagging', () => {
    tagRun('run-1', 'dup');
    tagRun('run-1', 'dup');
    expect(getRunsByTag('dup')).toEqual(['run-1']);
  });

  it('throws for nonexistent run', () => {
    expect(() => tagRun('ghost', 'tag')).toThrow('Run not found');
  });

  it('throws for empty tag name', () => {
    expect(() => tagRun('run-1', '')).toThrow('Tag name cannot be empty');
  });

  it('untags a run', () => {
    tagRun('run-1', 'remove-me');
    expect(untagRun('run-1', 'remove-me')).toBe(true);
    expect(getRunTags('run-1')).toEqual([]);
  });

  it('returns false when untagging nonexistent tag', () => {
    expect(untagRun('run-1', 'ghost')).toBe(false);
  });

  it('lists all tags', () => {
    tagRun('run-1', 'alpha', 'Alpha release');
    tagRun('run-2', 'beta');

    const tags = listTags();
    expect(tags).toHaveLength(2);
    expect(tags[0].tag).toBe('alpha');
    expect(tags[0].count).toBe(1);
    expect(tags[0].description).toBe('Alpha release');
    expect(tags[1].tag).toBe('beta');
  });

  it('deletes a tag', () => {
    tagRun('run-1', 'del-tag');
    expect(deleteTag('del-tag')).toBe(true);
    expect(listTags()).toHaveLength(0);
  });

  it('returns false when deleting nonexistent tag', () => {
    expect(deleteTag('ghost')).toBe(false);
  });

  it('renames a tag', () => {
    tagRun('run-1', 'old-name');
    expect(renameTag('old-name', 'new-name')).toBe(true);
    expect(getRunsByTag('new-name')).toEqual(['run-1']);
    expect(getRunsByTag('old-name')).toEqual([]);
  });

  it('throws when renaming to existing tag', () => {
    tagRun('run-1', 'tag-a');
    tagRun('run-2', 'tag-b');
    expect(() => renameTag('tag-a', 'tag-b')).toThrow('already exists');
  });

  it('returns false when renaming nonexistent tag', () => {
    expect(renameTag('ghost', 'new')).toBe(false);
  });

  it('returns empty for unknown tag', () => {
    expect(getRunsByTag('unknown')).toEqual([]);
  });

  it('returns empty tags for untagged run', () => {
    expect(getRunTags('untagged-run')).toEqual([]);
  });

  it('updates tag description', () => {
    tagRun('run-1', 'desc-tag', 'initial');
    tagRun('run-1', 'desc-tag', 'updated');

    const tags = listTags();
    expect(tags[0].description).toBe('updated');
  });
});
