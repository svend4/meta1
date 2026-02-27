import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  archiveRuns,
  restoreArchive,
  listArchives,
  deleteArchive,
} from '../../src/core/archive.js';

let tempDir: string;
let runsDir: string;

vi.mock('../../src/core/paths.js', () => ({
  getBaseDir: () => tempDir,
  getRunDir: (runId: string) => join(tempDir, 'runs', runId),
  getRunsDir: () => join(tempDir, 'runs'),
  getSummaryPath: (runId: string) => join(tempDir, 'runs', runId, 'summary.json'),
}));

vi.mock('../../src/storage/runs.js', () => ({
  runExists: (runId: string) => existsSync(join(tempDir, 'runs', runId, 'summary.json')),
}));

function createFakeRun(runId: string): void {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ run_id: runId, status: 'completed' }));
  writeFileSync(join(runDir, 'events.jsonl'), '{"event":"test"}\n');
}

describe('archive', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'continuum-archive-'));
    runsDir = join(tempDir, 'runs');
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('archives runs and creates manifest', async () => {
    createFakeRun('run-1');
    createFakeRun('run-2');

    const { archiveId, manifest, path } = await archiveRuns(['run-1', 'run-2'], {
      archiveId: 'test-archive',
    });

    expect(archiveId).toBe('test-archive');
    expect(manifest.run_count).toBe(2);
    expect(manifest.run_ids).toEqual(['run-1', 'run-2']);
    expect(manifest.version).toBe('1.0');
    expect(existsSync(path)).toBe(true);
  });

  it('throws for nonexistent run', async () => {
    await expect(archiveRuns(['ghost'])).rejects.toThrow('Runs not found: ghost');
  });

  it('deletes runs after archiving when requested', async () => {
    createFakeRun('run-del');

    await archiveRuns(['run-del'], {
      archiveId: 'del-archive',
      deleteAfter: true,
    });

    expect(existsSync(join(runsDir, 'run-del'))).toBe(false);
  });

  it('restores archived runs', async () => {
    createFakeRun('run-restore');

    await archiveRuns(['run-restore'], {
      archiveId: 'restore-archive',
      deleteAfter: true,
    });

    expect(existsSync(join(runsDir, 'run-restore'))).toBe(false);

    const { restoredIds } = await restoreArchive('restore-archive');
    expect(restoredIds).toEqual(['run-restore']);
    expect(existsSync(join(runsDir, 'run-restore', 'summary.json'))).toBe(true);
  });

  it('skips existing runs during restore', async () => {
    createFakeRun('run-skip');

    await archiveRuns(['run-skip'], { archiveId: 'skip-archive' });

    const { restoredIds, skippedIds } = await restoreArchive('skip-archive');
    expect(skippedIds).toEqual(['run-skip']);
    expect(restoredIds).toHaveLength(0);
  });

  it('overwrites existing runs when requested', async () => {
    createFakeRun('run-overwrite');

    await archiveRuns(['run-overwrite'], { archiveId: 'ow-archive' });

    const { restoredIds } = await restoreArchive('ow-archive', { overwrite: true });
    expect(restoredIds).toEqual(['run-overwrite']);
  });

  it('throws for nonexistent archive during restore', async () => {
    await expect(restoreArchive('ghost')).rejects.toThrow('Archive not found');
  });

  it('lists archives', async () => {
    createFakeRun('run-list');
    await archiveRuns(['run-list'], { archiveId: 'list-1' });

    const archives = listArchives();
    expect(archives).toHaveLength(1);
    expect(archives[0].archiveId).toBe('list-1');
    expect(archives[0].sizeBytes).toBeGreaterThan(0);
  });

  it('deletes an archive', async () => {
    createFakeRun('run-da');
    await archiveRuns(['run-da'], { archiveId: 'del-target' });

    expect(deleteArchive('del-target')).toBe(true);
    expect(listArchives()).toHaveLength(0);
  });

  it('returns false for deleting nonexistent archive', () => {
    expect(deleteArchive('ghost')).toBe(false);
  });
});
