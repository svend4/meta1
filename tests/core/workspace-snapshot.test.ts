import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  takeSnapshot,
  rollbackToSnapshot,
  diffSnapshot,
  listSnapshots,
  deleteSnapshot,
} from '../../src/core/workspace-snapshot.js';

let tempDir: string;
let workspace: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
}));

function createWorkspace(): void {
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'file1.txt'), 'hello');
  writeFileSync(join(workspace, 'file2.txt'), 'world');
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(join(workspace, 'src', 'index.ts'), 'console.log("hi")');
}

describe('workspace-snapshot', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-snap-'));
    workspace = join(tempDir, 'ws');
    createWorkspace();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('takes a snapshot', () => {
    const snap = takeSnapshot(workspace, { snapshotId: 'test-snap' });
    expect(snap.snapshot_id).toBe('test-snap');
    expect(snap.total_files).toBe(3);
    expect(snap.total_size_bytes).toBeGreaterThan(0);
    expect(snap.files).toHaveLength(3);
  });

  it('captures file hashes', () => {
    const snap = takeSnapshot(workspace);
    const f1 = snap.files.find((f) => f.relative_path === 'file1.txt');
    expect(f1).toBeDefined();
    expect(f1!.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rollbacks modified files', () => {
    const snap = takeSnapshot(workspace, { snapshotId: 'rb' });

    // Modify a file
    writeFileSync(join(workspace, 'file1.txt'), 'CHANGED');

    const { restored } = rollbackToSnapshot('rb');
    expect(restored).toBe(1);
    expect(readFileSync(join(workspace, 'file1.txt'), 'utf8')).toBe('hello');
  });

  it('skips unchanged files during rollback', () => {
    const snap = takeSnapshot(workspace, { snapshotId: 'skip' });
    const { restored } = rollbackToSnapshot('skip');
    expect(restored).toBe(0);
  });

  it('removes new files when requested', () => {
    takeSnapshot(workspace, { snapshotId: 'rm-new' });

    writeFileSync(join(workspace, 'new-file.txt'), 'new');

    const { removed } = rollbackToSnapshot('rm-new', { removeNew: true });
    expect(removed).toBe(1);
    expect(existsSync(join(workspace, 'new-file.txt'))).toBe(false);
  });

  it('diffs snapshot against current', () => {
    takeSnapshot(workspace, { snapshotId: 'diff-snap' });

    writeFileSync(join(workspace, 'file1.txt'), 'MODIFIED');
    writeFileSync(join(workspace, 'new.txt'), 'added');
    rmSync(join(workspace, 'file2.txt'));

    const diff = diffSnapshot('diff-snap');
    expect(diff.modified).toContain('file1.txt');
    expect(diff.added).toContain('new.txt');
    expect(diff.deleted).toContain('file2.txt');
  });

  it('lists snapshots', () => {
    takeSnapshot(workspace, { snapshotId: 'list-1' });
    takeSnapshot(workspace, { snapshotId: 'list-2' });

    const snaps = listSnapshots();
    expect(snaps).toHaveLength(2);
  });

  it('deletes a snapshot', () => {
    takeSnapshot(workspace, { snapshotId: 'del' });
    expect(deleteSnapshot('del')).toBe(true);
    expect(listSnapshots()).toHaveLength(0);
  });

  it('returns false for deleting nonexistent snapshot', () => {
    expect(deleteSnapshot('ghost')).toBe(false);
  });

  it('throws for nonexistent snapshot rollback', () => {
    expect(() => rollbackToSnapshot('ghost')).toThrow('Snapshot not found');
  });

  it('ignores node_modules', () => {
    mkdirSync(join(workspace, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(workspace, 'node_modules', 'pkg', 'index.js'), 'x');

    const snap = takeSnapshot(workspace);
    expect(snap.files.every((f) => !f.relative_path.includes('node_modules'))).toBe(true);
  });
});
