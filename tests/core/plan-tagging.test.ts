import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTag, listTags, resolveTagOrHash } from '../../src/cli/freeze.js';
import type { PlanTag } from '../../src/cli/freeze.js';
import * as paths from '../../src/core/paths.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-tags-'));
  vi.spyOn(paths, 'getBaseDir').mockReturnValue(tempDir);
  vi.spyOn(paths, 'getFreezeDir').mockReturnValue(join(tempDir, 'freeze'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

// Helper to create a tag directly
function createTag(tag: string, planHash: string, description?: string): void {
  const { mkdirSync, writeFileSync } = require('fs');
  const dir = join(tempDir, 'freeze', 'tags');
  mkdirSync(dir, { recursive: true });
  const tagData: PlanTag = {
    tag,
    plan_hash: planHash,
    created_at: new Date().toISOString(),
    environment: {
      node_version: 'v20.0.0',
      npm_version: '10.0.0',
      platform: 'linux',
      arch: 'x64',
      timestamp: new Date().toISOString(),
    },
    description,
  };
  writeFileSync(join(dir, `${tag}.json`), JSON.stringify(tagData, null, 2), 'utf8');
}

describe('loadTag', () => {
  it('returns null for non-existent tag', () => {
    expect(loadTag('nonexistent')).toBeNull();
  });

  it('loads a saved tag', () => {
    createTag('v1.0', 'sha256:abc123');
    const tag = loadTag('v1.0');
    expect(tag).not.toBeNull();
    expect(tag!.tag).toBe('v1.0');
    expect(tag!.plan_hash).toBe('sha256:abc123');
  });

  it('loads tag with description', () => {
    createTag('stable', 'sha256:def456', 'Production baseline');
    const tag = loadTag('stable');
    expect(tag!.description).toBe('Production baseline');
  });
});

describe('listTags', () => {
  it('returns empty array when no tags exist', () => {
    expect(listTags()).toEqual([]);
  });

  it('lists all tags sorted by creation date', () => {
    createTag('v1.0', 'sha256:aaa');
    createTag('v2.0', 'sha256:bbb');
    createTag('v3.0', 'sha256:ccc');

    const tags = listTags();
    expect(tags).toHaveLength(3);
    expect(tags.map((t) => t.tag)).toContain('v1.0');
    expect(tags.map((t) => t.tag)).toContain('v2.0');
    expect(tags.map((t) => t.tag)).toContain('v3.0');
  });
});

describe('resolveTagOrHash', () => {
  it('returns sha256 hash as-is', () => {
    expect(resolveTagOrHash('sha256:abc123')).toBe('sha256:abc123');
  });

  it('returns 64-char hex as-is', () => {
    const hex = 'a'.repeat(64);
    expect(resolveTagOrHash(hex)).toBe(hex);
  });

  it('resolves tag to plan hash', () => {
    createTag('stable', 'sha256:myplanhash');
    expect(resolveTagOrHash('stable')).toBe('sha256:myplanhash');
  });

  it('returns input as-is when tag not found', () => {
    expect(resolveTagOrHash('unknown-tag')).toBe('unknown-tag');
  });
});
