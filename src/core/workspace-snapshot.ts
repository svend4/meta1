/**
 * Workspace snapshot — captures file state before a run and supports
 * rollback on failure. Snapshots are lightweight: they record file
 * hashes and store changed files for restoration.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { getBaseDir } from './paths.js';

/** A snapshot of workspace state */
export interface WorkspaceSnapshot {
  snapshot_id: string;
  workspace: string;
  created_at: string;
  files: SnapshotFileEntry[];
  total_files: number;
  total_size_bytes: number;
}

/** Entry for a single file in the snapshot */
export interface SnapshotFileEntry {
  relative_path: string;
  hash: string;
  size_bytes: number;
}

/** Options for taking a snapshot */
export interface SnapshotOptions {
  /** File patterns to ignore (glob-like, simple suffix match) */
  ignore?: string[];
  /** Maximum file size to snapshot (bytes). Default: 10MB */
  maxFileSize?: number;
  /** Custom snapshot ID */
  snapshotId?: string;
}

function getSnapshotsDir(): string {
  return join(getBaseDir(), 'snapshots');
}

function getSnapshotDir(snapshotId: string): string {
  return join(getSnapshotsDir(), snapshotId);
}

const DEFAULT_IGNORE = [
  'node_modules', '.git', '.continuum', '__pycache__',
  '.DS_Store', 'Thumbs.db', '.env',
];

/**
 * Take a snapshot of the workspace.
 */
export function takeSnapshot(workspace: string, options?: SnapshotOptions): WorkspaceSnapshot {
  const snapshotId = options?.snapshotId ?? `snap-${Date.now()}`;
  const snapshotDir = getSnapshotDir(snapshotId);
  const filesDir = join(snapshotDir, 'files');
  mkdirSync(filesDir, { recursive: true });

  const ignore = [...DEFAULT_IGNORE, ...(options?.ignore ?? [])];
  const maxSize = options?.maxFileSize ?? 10 * 1024 * 1024;

  const files: SnapshotFileEntry[] = [];
  let totalSize = 0;

  collectWorkspaceFiles(workspace, '', ignore, maxSize, (relPath, fullPath) => {
    const content = readFileSync(fullPath);
    const hash = createHash('sha256').update(content).digest('hex');
    const size = content.length;

    // Store file content
    const destPath = join(filesDir, relPath);
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(fullPath, destPath);

    files.push({ relative_path: relPath, hash, size_bytes: size });
    totalSize += size;
  });

  const snapshot: WorkspaceSnapshot = {
    snapshot_id: snapshotId,
    workspace,
    created_at: new Date().toISOString(),
    files,
    total_files: files.length,
    total_size_bytes: totalSize,
  };

  writeFileSync(
    join(snapshotDir, 'manifest.json'),
    JSON.stringify(snapshot, null, 2),
    'utf8',
  );

  return snapshot;
}

/**
 * Rollback workspace to a snapshot state.
 * Restores files that were present in the snapshot and removes files
 * that were added after the snapshot.
 */
export function rollbackToSnapshot(
  snapshotId: string,
  options?: { removeNew?: boolean },
): { restored: number; removed: number } {
  const snapshotDir = getSnapshotDir(snapshotId);
  const manifestPath = join(snapshotDir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  const snapshot = JSON.parse(readFileSync(manifestPath, 'utf8')) as WorkspaceSnapshot;
  const filesDir = join(snapshotDir, 'files');
  const removeNew = options?.removeNew ?? false;

  let restored = 0;
  let removed = 0;

  // Restore files from snapshot
  for (const entry of snapshot.files) {
    const srcPath = join(filesDir, entry.relative_path);
    const dstPath = join(snapshot.workspace, entry.relative_path);

    if (!existsSync(srcPath)) continue;

    // Check if file has changed
    if (existsSync(dstPath)) {
      const currentHash = createHash('sha256')
        .update(readFileSync(dstPath))
        .digest('hex');
      if (currentHash === entry.hash) continue; // No change
    }

    mkdirSync(dirname(dstPath), { recursive: true });
    copyFileSync(srcPath, dstPath);
    restored++;
  }

  // Remove files added after snapshot
  if (removeNew) {
    const snapshotPaths = new Set(snapshot.files.map((f) => f.relative_path));
    const currentFiles = listWorkspaceFiles(snapshot.workspace, DEFAULT_IGNORE);

    for (const currentFile of currentFiles) {
      if (!snapshotPaths.has(currentFile)) {
        const fullPath = join(snapshot.workspace, currentFile);
        rmSync(fullPath, { force: true });
        removed++;
      }
    }
  }

  return { restored, removed };
}

/**
 * Compare current workspace against a snapshot.
 */
export function diffSnapshot(snapshotId: string): {
  added: string[];
  modified: string[];
  deleted: string[];
} {
  const snapshotDir = getSnapshotDir(snapshotId);
  const manifestPath = join(snapshotDir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  const snapshot = JSON.parse(readFileSync(manifestPath, 'utf8')) as WorkspaceSnapshot;
  const snapshotFiles = new Map(snapshot.files.map((f) => [f.relative_path, f.hash]));

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  // Check current files against snapshot
  const currentFiles = listWorkspaceFiles(snapshot.workspace, DEFAULT_IGNORE);
  const currentSet = new Set(currentFiles);

  for (const file of currentFiles) {
    const snapshotHash = snapshotFiles.get(file);
    if (!snapshotHash) {
      added.push(file);
    } else {
      const fullPath = join(snapshot.workspace, file);
      const currentHash = createHash('sha256')
        .update(readFileSync(fullPath))
        .digest('hex');
      if (currentHash !== snapshotHash) {
        modified.push(file);
      }
    }
  }

  // Check for deleted files
  for (const [path] of snapshotFiles) {
    if (!currentSet.has(path)) {
      deleted.push(path);
    }
  }

  return { added, modified, deleted };
}

/**
 * Load a snapshot manifest.
 */
export function loadSnapshot(snapshotId: string): WorkspaceSnapshot {
  const manifestPath = join(getSnapshotDir(snapshotId), 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as WorkspaceSnapshot;
}

/**
 * List all snapshots.
 */
export function listSnapshots(): WorkspaceSnapshot[] {
  const dir = getSnapshotsDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((d) => existsSync(join(dir, d, 'manifest.json')))
    .map((d) => JSON.parse(readFileSync(join(dir, d, 'manifest.json'), 'utf8')) as WorkspaceSnapshot)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * Delete a snapshot.
 */
export function deleteSnapshot(snapshotId: string): boolean {
  const dir = getSnapshotDir(snapshotId);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

// ── Internal helpers ──

function collectWorkspaceFiles(
  rootDir: string,
  prefix: string,
  ignore: string[],
  maxSize: number,
  callback: (relPath: string, fullPath: string) => void,
): void {
  if (!existsSync(rootDir)) return;

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (ignore.some((pat) => entry.name === pat || entry.name.endsWith(pat))) continue;

    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = join(rootDir, entry.name);

    if (entry.isDirectory()) {
      collectWorkspaceFiles(fullPath, relPath, ignore, maxSize, callback);
    } else if (entry.isFile()) {
      const stat = statSync(fullPath);
      if (stat.size <= maxSize) {
        callback(relPath, fullPath);
      }
    }
  }
}

function listWorkspaceFiles(rootDir: string, ignore: string[]): string[] {
  const files: string[] = [];
  collectWorkspaceFiles(rootDir, '', ignore, Infinity, (relPath) => {
    files.push(relPath);
  });
  return files;
}
