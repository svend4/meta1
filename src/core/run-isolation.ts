/**
 * Run isolation manager — isolate runs in separate workspace directories
 * with lifecycle hooks (setup, teardown), automatic cleanup, and
 * artifact collection from isolated workspaces.
 */

import { existsSync, mkdirSync, rmSync, cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { getBaseDir } from './paths.js';

/** Isolation mode */
export type IsolationMode = 'none' | 'directory' | 'copy';

/** Configuration for run isolation */
export interface IsolationConfig {
  /** Isolation mode: none, directory (empty workspace), copy (clone source) */
  mode: IsolationMode;
  /** Base directory for isolated workspaces. Default: system temp */
  baseDir?: string;
  /** Source directory to copy from (for 'copy' mode) */
  sourceDir?: string;
  /** Glob patterns to exclude from copy */
  excludePatterns?: string[];
  /** Auto-cleanup workspace after run completes */
  autoCleanup: boolean;
  /** Collect artifacts from workspace before cleanup */
  collectArtifacts?: string[];
  /** Maximum workspace age in ms before forced cleanup */
  maxAgeMs?: number;
}

/** An isolated workspace */
export interface IsolatedWorkspace {
  runId: string;
  workspacePath: string;
  mode: IsolationMode;
  createdAt: string;
  status: 'active' | 'completed' | 'failed' | 'cleaned';
  artifacts: CollectedArtifact[];
}

/** An artifact collected from an isolated workspace */
export interface CollectedArtifact {
  name: string;
  sourcePath: string;
  content: string;
  collectedAt: string;
}

/** Registry tracking all isolated workspaces */
interface WorkspaceRegistry {
  workspaces: IsolatedWorkspace[];
}

function getRegistryPath(): string {
  return join(getBaseDir(), 'workspace-registry.json');
}

function loadRegistry(): WorkspaceRegistry {
  const path = getRegistryPath();
  if (!existsSync(path)) return { workspaces: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

function saveRegistry(registry: WorkspaceRegistry): void {
  mkdirSync(getBaseDir(), { recursive: true });
  writeFileSync(getRegistryPath(), JSON.stringify(registry, null, 2), 'utf8');
}

/**
 * Create an isolated workspace for a run.
 */
export function createWorkspace(runId: string, config: IsolationConfig): IsolatedWorkspace {
  const base = config.baseDir ?? join(tmpdir(), 'continuum-isolated');
  const workspacePath = join(base, `run-${runId}-${Date.now()}`);

  mkdirSync(workspacePath, { recursive: true });

  if (config.mode === 'copy' && config.sourceDir) {
    copyDirectory(config.sourceDir, workspacePath, config.excludePatterns ?? []);
  }

  const workspace: IsolatedWorkspace = {
    runId,
    workspacePath,
    mode: config.mode,
    createdAt: new Date().toISOString(),
    status: 'active',
    artifacts: [],
  };

  const registry = loadRegistry();
  registry.workspaces.push(workspace);
  saveRegistry(registry);

  return workspace;
}

/**
 * Mark a workspace as completed and optionally collect artifacts.
 */
export function completeWorkspace(
  runId: string,
  config: IsolationConfig,
): IsolatedWorkspace | null {
  const registry = loadRegistry();
  const workspace = registry.workspaces.find((w) => w.runId === runId && w.status === 'active');
  if (!workspace) return null;

  // Collect artifacts before cleanup
  if (config.collectArtifacts) {
    for (const pattern of config.collectArtifacts) {
      const artifacts = collectFromWorkspace(workspace.workspacePath, pattern);
      workspace.artifacts.push(...artifacts);
    }
  }

  workspace.status = 'completed';

  if (config.autoCleanup) {
    cleanupWorkspace(workspace);
  }

  saveRegistry(registry);
  return workspace;
}

/**
 * Mark a workspace as failed.
 */
export function failWorkspace(runId: string, config: IsolationConfig): IsolatedWorkspace | null {
  const registry = loadRegistry();
  const workspace = registry.workspaces.find((w) => w.runId === runId && w.status === 'active');
  if (!workspace) return null;

  // Collect artifacts even on failure
  if (config.collectArtifacts) {
    for (const pattern of config.collectArtifacts) {
      const artifacts = collectFromWorkspace(workspace.workspacePath, pattern);
      workspace.artifacts.push(...artifacts);
    }
  }

  workspace.status = 'failed';

  if (config.autoCleanup) {
    cleanupWorkspace(workspace);
  }

  saveRegistry(registry);
  return workspace;
}

/**
 * Get an active workspace by run ID.
 */
export function getWorkspace(runId: string): IsolatedWorkspace | null {
  const registry = loadRegistry();
  return registry.workspaces.find((w) => w.runId === runId) ?? null;
}

/**
 * List all tracked workspaces.
 */
export function listWorkspaces(filter?: { status?: IsolatedWorkspace['status'] }): IsolatedWorkspace[] {
  const registry = loadRegistry();
  if (!filter?.status) return registry.workspaces;
  return registry.workspaces.filter((w) => w.status === filter.status);
}

/**
 * Clean up a specific workspace directory.
 */
export function cleanupWorkspace(workspace: IsolatedWorkspace): void {
  if (existsSync(workspace.workspacePath)) {
    rmSync(workspace.workspacePath, { recursive: true, force: true });
  }
  workspace.status = 'cleaned';
}

/**
 * Clean up stale workspaces older than maxAgeMs.
 */
export function cleanupStaleWorkspaces(maxAgeMs: number): number {
  const registry = loadRegistry();
  const now = Date.now();
  let cleaned = 0;

  for (const workspace of registry.workspaces) {
    if (workspace.status === 'cleaned') continue;

    const age = now - new Date(workspace.createdAt).getTime();
    if (age > maxAgeMs) {
      cleanupWorkspace(workspace);
      cleaned++;
    }
  }

  saveRegistry(registry);
  return cleaned;
}

/**
 * Get default isolation config.
 */
export function defaultIsolationConfig(): IsolationConfig {
  return {
    mode: 'directory',
    autoCleanup: true,
    excludePatterns: ['node_modules', '.git', 'dist'],
  };
}

/**
 * Format workspace info for display.
 */
export function formatWorkspace(workspace: IsolatedWorkspace): string {
  const lines: string[] = [];
  lines.push(`Workspace: ${workspace.runId}`);
  lines.push(`  Path: ${workspace.workspacePath}`);
  lines.push(`  Mode: ${workspace.mode}`);
  lines.push(`  Status: ${workspace.status.toUpperCase()}`);
  lines.push(`  Created: ${workspace.createdAt}`);
  if (workspace.artifacts.length > 0) {
    lines.push(`  Artifacts: ${workspace.artifacts.length}`);
    for (const a of workspace.artifacts) {
      lines.push(`    - ${a.name}`);
    }
  }
  return lines.join('\n');
}

// ── Internal ──

function copyDirectory(src: string, dest: string, exclude: string[]): void {
  if (!existsSync(src)) return;

  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;

    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirectory(srcPath, destPath, exclude);
    } else {
      cpSync(srcPath, destPath);
    }
  }
}

function collectFromWorkspace(workspacePath: string, pattern: string): CollectedArtifact[] {
  const artifacts: CollectedArtifact[] = [];
  const targetPath = resolve(workspacePath, pattern);

  if (existsSync(targetPath)) {
    try {
      const content = readFileSync(targetPath, 'utf8');
      artifacts.push({
        name: pattern,
        sourcePath: targetPath,
        content,
        collectedAt: new Date().toISOString(),
      });
    } catch {
      // Skip binary or unreadable files
    }
  }

  return artifacts;
}
