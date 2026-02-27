/**
 * Workspace diff — compare file-level changes between two runs
 * by examining the workspace state captured in run forensics/outputs.
 */

import { loadRunSummary } from '../storage/runs.js';
import type { RunSummary } from '../types/run-summary.js';

/** A file difference between two runs */
export interface FileDiff {
  path: string;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  /** Content in run A (if present) */
  contentA?: string;
  /** Content in run B (if present) */
  contentB?: string;
  /** Line-level diff (if modified) */
  lineDiff?: LineDiff[];
}

/** A single line difference */
export interface LineDiff {
  lineNumber: number;
  type: 'add' | 'remove' | 'context';
  content: string;
}

/** Full workspace diff result */
export interface WorkspaceDiffResult {
  runA: string;
  runB: string;
  files: FileDiff[];
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

/**
 * Compare the file outputs of two runs.
 * Uses create_file step data from the plan to determine what files each run produced.
 */
export function diffWorkspaces(runIdA: string, runIdB: string): WorkspaceDiffResult {
  const summaryA = loadRunSummary(runIdA);
  const summaryB = loadRunSummary(runIdB);

  const filesA = extractFileOutputs(summaryA);
  const filesB = extractFileOutputs(summaryB);

  const allPaths = new Set([...filesA.keys(), ...filesB.keys()]);
  const files: FileDiff[] = [];

  let added = 0, removed = 0, modified = 0, unchanged = 0;

  for (const path of [...allPaths].sort()) {
    const contentA = filesA.get(path);
    const contentB = filesB.get(path);

    if (contentA === undefined && contentB !== undefined) {
      files.push({ path, status: 'added', contentB });
      added++;
    } else if (contentA !== undefined && contentB === undefined) {
      files.push({ path, status: 'removed', contentA });
      removed++;
    } else if (contentA !== contentB) {
      files.push({
        path,
        status: 'modified',
        contentA,
        contentB,
        lineDiff: computeLineDiff(contentA!, contentB!),
      });
      modified++;
    } else {
      files.push({ path, status: 'unchanged' });
      unchanged++;
    }
  }

  return {
    runA: runIdA,
    runB: runIdB,
    files,
    summary: { added, removed, modified, unchanged },
  };
}

/**
 * Format a workspace diff for human-readable output.
 */
export function formatWorkspaceDiff(diff: WorkspaceDiffResult, options?: { showContent?: boolean }): string {
  const lines: string[] = [];
  const showContent = options?.showContent ?? false;

  lines.push(`Workspace Diff: ${diff.runA.slice(0, 8)} ↔ ${diff.runB.slice(0, 8)}`);
  lines.push('');
  lines.push(`  Added: ${diff.summary.added}  Modified: ${diff.summary.modified}  Removed: ${diff.summary.removed}  Unchanged: ${diff.summary.unchanged}`);
  lines.push('');

  for (const file of diff.files) {
    if (file.status === 'unchanged') continue;

    const icon = file.status === 'added' ? '+' : file.status === 'removed' ? '-' : '~';
    lines.push(`  ${icon} ${file.path}`);

    if (showContent && file.lineDiff) {
      for (const line of file.lineDiff) {
        const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
        lines.push(`    ${prefix} ${line.content}`);
      }
    }
  }

  return lines.join('\n');
}

// ── Internal ──

/**
 * Extract file outputs from a run summary by looking at create_file steps in the plan.
 */
function extractFileOutputs(summary: RunSummary): Map<string, string> {
  const files = new Map<string, string>();

  for (const planStep of summary.plan.steps) {
    if (planStep.type === 'create_file') {
      const step = planStep as { path: string; content: string };
      // Only include files from completed steps
      const result = summary.steps.find((s) => s.step_id === planStep.step_id);
      if (result && result.status === 'completed') {
        files.set(step.path, step.content);
      }
    }
  }

  return files;
}

/**
 * Simple line-level diff using longest common subsequence approach.
 */
function computeLineDiff(a: string, b: string): LineDiff[] {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const diffs: LineDiff[] = [];

  // Simple diff: find common prefix, common suffix, then mark middle as changed
  let prefixLen = 0;
  const minLen = Math.min(linesA.length, linesB.length);

  while (prefixLen < minLen && linesA[prefixLen] === linesB[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    linesA[linesA.length - 1 - suffixLen] === linesB[linesB.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  // Context lines (common prefix)
  const contextCount = Math.min(3, prefixLen);
  for (let i = Math.max(0, prefixLen - contextCount); i < prefixLen; i++) {
    diffs.push({ lineNumber: i + 1, type: 'context', content: linesA[i] });
  }

  // Removed lines from A
  for (let i = prefixLen; i < linesA.length - suffixLen; i++) {
    diffs.push({ lineNumber: i + 1, type: 'remove', content: linesA[i] });
  }

  // Added lines from B
  for (let i = prefixLen; i < linesB.length - suffixLen; i++) {
    diffs.push({ lineNumber: i + 1, type: 'add', content: linesB[i] });
  }

  // Context lines (common suffix)
  const suffixContext = Math.min(3, suffixLen);
  for (let i = 0; i < suffixContext; i++) {
    const idx = linesA.length - suffixLen + i;
    diffs.push({ lineNumber: idx + 1, type: 'context', content: linesA[idx] });
  }

  return diffs;
}
