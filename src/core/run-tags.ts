import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBaseDir } from './paths.js';
import { runExists } from '../storage/runs.js';

/** Tag database: maps tag names to sets of run IDs */
interface TagDatabase {
  version: '1.0';
  tags: Record<string, TagEntry>;
}

interface TagEntry {
  run_ids: string[];
  created_at: string;
  description?: string;
}

function getTagDbPath(): string {
  return join(getBaseDir(), 'run-tags.json');
}

function loadTagDb(): TagDatabase {
  const path = getTagDbPath();
  if (!existsSync(path)) {
    return { version: '1.0', tags: {} };
  }
  return JSON.parse(readFileSync(path, 'utf8')) as TagDatabase;
}

function saveTagDb(db: TagDatabase): void {
  const dir = getBaseDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getTagDbPath(), JSON.stringify(db, null, 2), 'utf8');
}

/**
 * Add a tag to a run.
 */
export function tagRun(runId: string, tag: string, description?: string): void {
  if (!runExists(runId)) {
    throw new Error(`Run not found: ${runId}`);
  }
  if (!tag || tag.trim().length === 0) {
    throw new Error('Tag name cannot be empty');
  }

  const db = loadTagDb();

  if (!db.tags[tag]) {
    db.tags[tag] = {
      run_ids: [],
      created_at: new Date().toISOString(),
      description,
    };
  }

  if (!db.tags[tag].run_ids.includes(runId)) {
    db.tags[tag].run_ids.push(runId);
  }

  if (description !== undefined) {
    db.tags[tag].description = description;
  }

  saveTagDb(db);
}

/**
 * Remove a tag from a run.
 */
export function untagRun(runId: string, tag: string): boolean {
  const db = loadTagDb();

  if (!db.tags[tag]) return false;

  const idx = db.tags[tag].run_ids.indexOf(runId);
  if (idx === -1) return false;

  db.tags[tag].run_ids.splice(idx, 1);

  // Remove empty tags
  if (db.tags[tag].run_ids.length === 0) {
    delete db.tags[tag];
  }

  saveTagDb(db);
  return true;
}

/**
 * Get all tags for a run.
 */
export function getRunTags(runId: string): string[] {
  const db = loadTagDb();
  return Object.entries(db.tags)
    .filter(([, entry]) => entry.run_ids.includes(runId))
    .map(([tag]) => tag)
    .sort();
}

/**
 * Get all run IDs with a specific tag.
 */
export function getRunsByTag(tag: string): string[] {
  const db = loadTagDb();
  return db.tags[tag]?.run_ids ?? [];
}

/**
 * List all tags with their run counts.
 */
export function listTags(): Array<{ tag: string; count: number; description?: string; created_at: string }> {
  const db = loadTagDb();
  return Object.entries(db.tags)
    .map(([tag, entry]) => ({
      tag,
      count: entry.run_ids.length,
      description: entry.description,
      created_at: entry.created_at,
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * Delete a tag entirely.
 */
export function deleteTag(tag: string): boolean {
  const db = loadTagDb();
  if (!db.tags[tag]) return false;
  delete db.tags[tag];
  saveTagDb(db);
  return true;
}

/**
 * Rename a tag.
 */
export function renameTag(oldName: string, newName: string): boolean {
  const db = loadTagDb();
  if (!db.tags[oldName]) return false;
  if (db.tags[newName]) {
    throw new Error(`Tag "${newName}" already exists`);
  }

  db.tags[newName] = db.tags[oldName];
  delete db.tags[oldName];
  saveTagDb(db);
  return true;
}
