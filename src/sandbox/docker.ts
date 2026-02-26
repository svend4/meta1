import { createRequire } from 'node:module';
import type { Sandbox, ExecResult } from './types.js';

const require = createRequire(import.meta.url);
const Docker = require('dockerode') as typeof import('dockerode');

const DEFAULT_IMAGE = 'node:20-slim';
const WORKSPACE_MOUNT = '/workspace';

export interface DockerSandboxOptions {
  image?: string;
  socketPath?: string;
}

/**
 * Docker-based sandbox: runs steps inside an isolated container.
 * Provides full filesystem isolation and reproducible environments.
 */
export class DockerSandbox implements Sandbox {
  private readonly docker: InstanceType<typeof Docker>;
  private readonly image: string;
  private container: InstanceType<typeof Docker.Container> | null = null;
  private imageDigest: string | null = null;

  constructor(
    private readonly hostWorkspace: string,
    options?: DockerSandboxOptions,
  ) {
    this.docker = new Docker(
      options?.socketPath ? { socketPath: options.socketPath } : undefined,
    );
    this.image = options?.image ?? DEFAULT_IMAGE;
  }

  async init(): Promise<void> {
    // Pull image if not present, capture digest
    const images = await this.docker.listImages({
      filters: { reference: [this.image] },
    });

    if (images.length === 0) {
      await new Promise<void>((resolve, reject) => {
        this.docker.pull(this.image, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          this.docker.modem.followProgress(stream, (pullErr: Error | null) => {
            if (pullErr) reject(pullErr);
            else resolve();
          });
        });
      });
    }

    // Capture image digest
    const inspected = await this.docker.getImage(this.image).inspect();
    this.imageDigest = inspected.Id;

    // Create container with workspace mount
    this.container = await this.docker.createContainer({
      Image: this.image,
      Cmd: ['sleep', 'infinity'],
      WorkingDir: WORKSPACE_MOUNT,
      HostConfig: {
        Binds: [`${this.hostWorkspace}:${WORKSPACE_MOUNT}`],
        NetworkMode: 'none',
      },
    });

    await this.container.start();
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    // Write through bind mount by executing inside container
    const escaped = content.replace(/'/g, "'\\''");
    await this.containerExec([
      'sh', '-c',
      `mkdir -p "$(dirname '${WORKSPACE_MOUNT}/${relativePath}')" && printf '%s' '${escaped}' > '${WORKSPACE_MOUNT}/${relativePath}'`,
    ]);
  }

  async readFile(relativePath: string): Promise<string> {
    const result = await this.containerExec([
      'cat', `${WORKSPACE_MOUNT}/${relativePath}`,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read ${relativePath}: ${result.stderr}`);
    }
    return result.stdout;
  }

  async exec(command: string, args: string[]): Promise<ExecResult> {
    return this.containerExec([command, ...args]);
  }

  getWorkspacePath(): string {
    return this.hostWorkspace;
  }

  /** Get the Docker image digest (available after init) */
  getImageDigest(): string | null {
    return this.imageDigest;
  }

  async destroy(): Promise<void> {
    if (this.container) {
      try {
        await this.container.stop({ t: 2 });
      } catch {
        // Container may already be stopped
      }
      await this.container.remove({ force: true });
      this.container = null;
    }
  }

  private async containerExec(cmd: string[]): Promise<ExecResult> {
    if (!this.container) {
      throw new Error('Sandbox not initialized — call init() first');
    }

    const exec = await this.container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: WORKSPACE_MOUNT,
    });

    const stream = await exec.start({ Detach: false, Tty: false });

    return new Promise<ExecResult>((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      this.docker.modem.demuxStream(
        stream,
        {
          write(chunk: Buffer) { stdoutChunks.push(chunk); return true; },
          end() {},
        } as unknown as NodeJS.WritableStream,
        {
          write(chunk: Buffer) { stderrChunks.push(chunk); return true; },
          end() {},
        } as unknown as NodeJS.WritableStream,
      );

      stream.on('end', async () => {
        try {
          const info = await exec.inspect();
          resolve({
            stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
            exitCode: info.ExitCode ?? 0,
          });
        } catch (err) {
          reject(err);
        }
      });

      stream.on('error', reject);
    });
  }
}
