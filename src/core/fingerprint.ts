import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DependencyFingerprint } from '../types/dependency-fingerprint.js';
import { hashString, hashObject } from './hasher.js';

/** Get version of a CLI tool, returning empty string if unavailable */
function getToolVersion(command: string, args: string[] = ['--version']): string {
  try {
    const output = execSync(`${command} ${args.join(' ')}`, {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    // Extract version number from common formats
    const match = output.match(/v?(\d+\.\d+\.\d+)/);
    return match ? match[1] : output.split('\n')[0].trim();
  } catch {
    return '';
  }
}

/** Detect and hash the lockfile in a workspace */
function detectLockfile(workspace: string): DependencyFingerprint['lockfile'] | undefined {
  const lockfiles: Array<{ path: string; format: 'npm' | 'pnpm' | 'yarn' }> = [
    { path: 'package-lock.json', format: 'npm' },
    { path: 'pnpm-lock.yaml', format: 'pnpm' },
    { path: 'yarn.lock', format: 'yarn' },
  ];

  for (const lf of lockfiles) {
    const fullPath = join(workspace, lf.path);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf8');
      return {
        path: lf.path,
        hash: hashString(content),
        format: lf.format,
      };
    }
  }

  return undefined;
}

/** Capture the dependency tree hash (npm ls --json) */
function captureDependencyTree(workspace: string): DependencyFingerprint['dependency_tree'] | undefined {
  try {
    const output = execSync('npm ls --json --depth=0', {
      encoding: 'utf8',
      cwd: workspace,
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(output);
    const deps = parsed.dependencies ?? {};
    return {
      hash: hashString(output),
      top_level_count: Object.keys(deps).length,
    };
  } catch {
    return undefined;
  }
}

/**
 * Capture a DependencyFingerprint for the current environment.
 * Called before every run and replay.
 */
export function captureDependencyFingerprint(
  workspace: string,
  sandboxImage?: { name: string; digest: string },
): DependencyFingerprint {
  const tools: DependencyFingerprint['tools'] = {
    node: getToolVersion('node'),
    npm: getToolVersion('npm'),
    git: getToolVersion('git') || undefined,
    docker: getToolVersion('docker') || undefined,
  };

  const lockfile = detectLockfile(workspace);
  const dependencyTree = captureDependencyTree(workspace);

  const fingerprint: DependencyFingerprint = {
    fingerprint_id: randomUUID(),
    captured_at: new Date().toISOString(),
    fingerprint_hash: '' as `sha256:${string}`, // computed below
    tools,
    lockfile,
    dependency_tree: dependencyTree,
    sandbox_image: sandboxImage,
  };

  // Compute fingerprint hash from all components
  fingerprint.fingerprint_hash = hashObject({
    tools: fingerprint.tools,
    lockfile_hash: fingerprint.lockfile?.hash,
    dep_tree_hash: fingerprint.dependency_tree?.hash,
    image_digest: fingerprint.sandbox_image?.digest,
  });

  return fingerprint;
}

/** Compare two fingerprints and return a list of drift descriptions */
export function compareDependencyFingerprints(
  original: DependencyFingerprint,
  current: DependencyFingerprint,
): string[] {
  const drifts: string[] = [];

  if (original.fingerprint_hash === current.fingerprint_hash) {
    return drifts;
  }

  // Compare tool versions
  if (original.tools.node !== current.tools.node) {
    drifts.push(`node: ${original.tools.node} → ${current.tools.node}`);
  }
  if (original.tools.npm !== current.tools.npm) {
    drifts.push(`npm: ${original.tools.npm} → ${current.tools.npm}`);
  }
  if (original.tools.git && current.tools.git && original.tools.git !== current.tools.git) {
    drifts.push(`git: ${original.tools.git} → ${current.tools.git}`);
  }
  if (original.tools.docker && current.tools.docker && original.tools.docker !== current.tools.docker) {
    drifts.push(`docker: ${original.tools.docker} → ${current.tools.docker}`);
  }

  // Compare lockfile
  if (original.lockfile && current.lockfile) {
    if (original.lockfile.hash !== current.lockfile.hash) {
      drifts.push(`lockfile (${original.lockfile.path}): hash changed`);
    }
  }

  // Compare sandbox image
  if (original.sandbox_image && current.sandbox_image) {
    if (original.sandbox_image.digest !== current.sandbox_image.digest) {
      drifts.push(`sandbox image: digest changed`);
    }
  }

  return drifts;
}
