import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Sandbox, ExecResult } from './types.js';

/**
 * Local sandbox: executes steps directly on the host filesystem.
 * Used for development, testing, and environments without Docker.
 */
export class LocalSandbox implements Sandbox {
  private readonly workspace: string;

  constructor(workspace: string) {
    this.workspace = workspace;
  }

  async init(): Promise<void> {
    mkdirSync(this.workspace, { recursive: true });
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = join(this.workspace, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }

  async readFile(relativePath: string): Promise<string> {
    return readFileSync(join(this.workspace, relativePath), 'utf8');
  }

  async exec(command: string, args: string[]): Promise<ExecResult> {
    try {
      const stdout = execFileSync(command, args, {
        cwd: this.workspace,
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout, stderr: '', exitCode: 0 };
    } catch (err: unknown) {
      const e = err as {
        stdout?: string;
        stderr?: string;
        status?: number;
        message?: string;
      };
      return {
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? e.message ?? 'unknown error',
        exitCode: e.status ?? 1,
      };
    }
  }

  getWorkspacePath(): string {
    return this.workspace;
  }

  async destroy(): Promise<void> {
    // Local sandbox does not auto-clean — workspace persists for inspection
  }
}
