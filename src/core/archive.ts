import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { createGzip, createGunzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { getBaseDir, getRunDir } from './paths.js';
import { runExists } from '../storage/runs.js';

/** Archive metadata stored alongside the archive */
export interface ArchiveManifest {
  version: '1.0';
  created_at: string;
  run_ids: string[];
  run_count: number;
  total_size_bytes: number;
}

function getArchiveDir(): string {
  return join(getBaseDir(), 'archives');
}

function getArchivePath(archiveId: string): string {
  return join(getArchiveDir(), `${archiveId}.tar.gz`);
}

function getManifestPath(archiveId: string): string {
  return join(getArchiveDir(), `${archiveId}.manifest.json`);
}

/**
 * Archive runs into a compressed tarball.
 * Returns the archive ID and manifest.
 */
export async function archiveRuns(
  runIds: string[],
  options?: { deleteAfter?: boolean; archiveId?: string },
): Promise<{ archiveId: string; manifest: ArchiveManifest; path: string }> {
  const archiveDir = getArchiveDir();
  mkdirSync(archiveDir, { recursive: true });

  // Validate all runs exist
  const missing = runIds.filter((id) => !runExists(id));
  if (missing.length > 0) {
    throw new Error(`Runs not found: ${missing.join(', ')}`);
  }

  const archiveId = options?.archiveId ?? `archive-${Date.now()}`;
  const archivePath = getArchivePath(archiveId);

  // Collect all run data into a single JSON structure
  const archiveData: Record<string, ArchiveEntry> = {};
  let totalSize = 0;

  for (const runId of runIds) {
    const runDir = getRunDir(runId);
    const entry: ArchiveEntry = { files: {} };

    if (existsSync(runDir)) {
      collectFiles(runDir, '', entry.files);
      for (const content of Object.values(entry.files)) {
        totalSize += Buffer.byteLength(content, 'utf8');
      }
    }

    archiveData[runId] = entry;
  }

  // Write compressed archive
  const jsonData = JSON.stringify(archiveData);
  const tempPath = archivePath + '.tmp';
  writeFileSync(tempPath, jsonData, 'utf8');

  await compressFile(tempPath, archivePath);
  rmSync(tempPath, { force: true });

  // Write manifest
  const manifest: ArchiveManifest = {
    version: '1.0',
    created_at: new Date().toISOString(),
    run_ids: runIds,
    run_count: runIds.length,
    total_size_bytes: totalSize,
  };

  writeFileSync(getManifestPath(archiveId), JSON.stringify(manifest, null, 2), 'utf8');

  // Optionally delete archived runs
  if (options?.deleteAfter) {
    for (const runId of runIds) {
      const runDir = getRunDir(runId);
      if (existsSync(runDir)) {
        rmSync(runDir, { recursive: true, force: true });
      }
    }
  }

  return { archiveId, manifest, path: archivePath };
}

/**
 * Restore runs from an archive.
 */
export async function restoreArchive(
  archiveId: string,
  options?: { overwrite?: boolean },
): Promise<{ restoredIds: string[]; skippedIds: string[] }> {
  const archivePath = getArchivePath(archiveId);
  if (!existsSync(archivePath)) {
    throw new Error(`Archive not found: ${archiveId}`);
  }

  // Decompress
  const tempPath = archivePath + '.restore.tmp';
  await decompressFile(archivePath, tempPath);

  const archiveData = JSON.parse(readFileSync(tempPath, 'utf8')) as Record<string, ArchiveEntry>;
  rmSync(tempPath, { force: true });

  const restoredIds: string[] = [];
  const skippedIds: string[] = [];

  for (const [runId, entry] of Object.entries(archiveData)) {
    const runDir = getRunDir(runId);

    if (existsSync(runDir) && !options?.overwrite) {
      skippedIds.push(runId);
      continue;
    }

    mkdirSync(runDir, { recursive: true });

    for (const [relativePath, content] of Object.entries(entry.files)) {
      const fullPath = join(runDir, relativePath);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content, 'utf8');
    }

    restoredIds.push(runId);
  }

  return { restoredIds, skippedIds };
}

/**
 * List all archives with their manifests.
 */
export function listArchives(): Array<{ archiveId: string; manifest: ArchiveManifest; sizeBytes: number }> {
  const dir = getArchiveDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.manifest.json'))
    .map((f) => {
      const archiveId = f.replace('.manifest.json', '');
      const manifest = JSON.parse(readFileSync(join(dir, f), 'utf8')) as ArchiveManifest;
      const archivePath = getArchivePath(archiveId);
      const sizeBytes = existsSync(archivePath) ? statSync(archivePath).size : 0;
      return { archiveId, manifest, sizeBytes };
    })
    .sort((a, b) => a.manifest.created_at.localeCompare(b.manifest.created_at));
}

/**
 * Delete an archive.
 */
export function deleteArchive(archiveId: string): boolean {
  const archivePath = getArchivePath(archiveId);
  const manifestPath = getManifestPath(archiveId);
  let deleted = false;

  if (existsSync(archivePath)) {
    rmSync(archivePath);
    deleted = true;
  }
  if (existsSync(manifestPath)) {
    rmSync(manifestPath);
    deleted = true;
  }

  return deleted;
}

// ── Internal helpers ──

interface ArchiveEntry {
  files: Record<string, string>;
}

function collectFiles(dir: string, prefix: string, out: Record<string, string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      collectFiles(full, rel, out);
    } else if (entry.isFile()) {
      out[rel] = readFileSync(full, 'utf8');
    }
  }
}

async function compressFile(src: string, dst: string): Promise<void> {
  await pipeline(
    createReadStream(src),
    createGzip({ level: 9 }),
    createWriteStream(dst),
  );
}

async function decompressFile(src: string, dst: string): Promise<void> {
  await pipeline(
    createReadStream(src),
    createGunzip(),
    createWriteStream(dst),
  );
}
