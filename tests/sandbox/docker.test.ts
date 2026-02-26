import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * DockerSandbox tests using mocked dockerode.
 *
 * Because docker.ts uses `createRequire(import.meta.url)` to load dockerode,
 * we mock `node:module` so that `createRequire` returns our controlled mock.
 */

// ── Build the mock Docker internals ──
const mockExecInspect = vi.fn();
const mockExecStart = vi.fn();
const mockContainerExec = vi.fn();
const mockContainerStart = vi.fn();
const mockContainerStop = vi.fn();
const mockContainerRemove = vi.fn();

const mockStream = {
  on: vi.fn(),
};

const mockExec = {
  start: mockExecStart,
  inspect: mockExecInspect,
};

const mockContainer = {
  exec: mockContainerExec,
  start: mockContainerStart,
  stop: mockContainerStop,
  remove: mockContainerRemove,
};

const mockImageInspect = vi.fn();
const mockGetImage = vi.fn();
const mockCreateContainer = vi.fn();
const mockListImages = vi.fn();
const mockPull = vi.fn();

const mockModem = {
  demuxStream: vi.fn(),
  followProgress: vi.fn(),
};

function MockDocker() {
  return {
    listImages: mockListImages,
    getImage: mockGetImage,
    createContainer: mockCreateContainer,
    pull: mockPull,
    modem: mockModem,
  };
}
MockDocker.Container = function() {};

// Mock node:module so createRequire returns our mock for dockerode
vi.mock('node:module', () => ({
  createRequire: () => {
    return (id: string) => {
      if (id === 'dockerode') return MockDocker;
      throw new Error(`Unexpected require: ${id}`);
    };
  },
}));

// Import after mocks
const { DockerSandbox } = await import('../../src/sandbox/docker.js');

function setupExecMock(stdout: string, stderr: string, exitCode: number): void {
  mockContainerExec.mockResolvedValue(mockExec);
  mockExecStart.mockResolvedValue(mockStream);
  mockExecInspect.mockResolvedValue({ ExitCode: exitCode });

  mockStream.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    if (event === 'end') {
      setTimeout(() => cb(), 10);
    }
    return mockStream;
  });

  mockModem.demuxStream.mockImplementation(
    (_stream: unknown, stdoutWriter: { write: (chunk: Buffer) => void }, stderrWriter: { write: (chunk: Buffer) => void }) => {
      if (stdout) stdoutWriter.write(Buffer.from(stdout));
      if (stderr) stderrWriter.write(Buffer.from(stderr));
    },
  );
}

describe('DockerSandbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockListImages.mockResolvedValue([{ Id: 'sha256:abc123' }]);
    mockGetImage.mockReturnValue({ inspect: mockImageInspect });
    mockImageInspect.mockResolvedValue({ Id: 'sha256:abc123def456' });
    mockCreateContainer.mockResolvedValue(mockContainer);
    mockContainerStart.mockResolvedValue(undefined);
    mockContainerStop.mockResolvedValue(undefined);
    mockContainerRemove.mockResolvedValue(undefined);
  });

  describe('constructor', () => {
    it('creates Docker instance with default options', () => {
      new DockerSandbox('/tmp/workspace');
    });

    it('accepts custom socket path', () => {
      new DockerSandbox('/tmp/workspace', { socketPath: '/var/run/docker.sock' });
    });

    it('accepts custom image', () => {
      new DockerSandbox('/tmp/workspace', { image: 'node:22-slim' });
    });
  });

  describe('init', () => {
    it('starts a container with workspace mount when image exists', async () => {
      const sandbox = new DockerSandbox('/tmp/workspace');
      await sandbox.init();

      expect(mockListImages).toHaveBeenCalledWith({
        filters: { reference: ['node:20-slim'] },
      });
      expect(mockCreateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Image: 'node:20-slim',
          Cmd: ['sleep', 'infinity'],
          WorkingDir: '/workspace',
          HostConfig: expect.objectContaining({
            Binds: ['/tmp/workspace:/workspace'],
            NetworkMode: 'none',
          }),
        }),
      );
      expect(mockContainerStart).toHaveBeenCalled();
    });

    it('pulls image when not found locally', async () => {
      mockListImages.mockResolvedValue([]);
      const mockPullStream = { on: vi.fn() };
      mockPull.mockImplementation((_image: string, cb: (err: Error | null, stream: unknown) => void) => {
        cb(null, mockPullStream);
      });
      mockModem.followProgress.mockImplementation((_stream: unknown, cb: (err: Error | null) => void) => {
        cb(null);
      });

      const sandbox = new DockerSandbox('/tmp/workspace');
      await sandbox.init();

      expect(mockPull).toHaveBeenCalledWith('node:20-slim', expect.any(Function));
    });

    it('captures image digest', async () => {
      const sandbox = new DockerSandbox('/tmp/workspace');
      await sandbox.init();

      expect(mockImageInspect).toHaveBeenCalled();
      expect(sandbox.getImageDigest()).toBe('sha256:abc123def456');
    });

    it('uses custom image name', async () => {
      const sandbox = new DockerSandbox('/tmp/workspace', { image: 'node:22-alpine' });
      await sandbox.init();

      expect(mockListImages).toHaveBeenCalledWith({
        filters: { reference: ['node:22-alpine'] },
      });
    });

    it('rejects when pull fails', async () => {
      mockListImages.mockResolvedValue([]);
      mockPull.mockImplementation((_image: string, cb: (err: Error | null) => void) => {
        cb(new Error('network timeout'));
      });

      const sandbox = new DockerSandbox('/tmp/workspace');
      await expect(sandbox.init()).rejects.toThrow('network timeout');
    });
  });

  describe('writeFile', () => {
    it('writes file inside container via exec', async () => {
      const sandbox = new DockerSandbox('/tmp/workspace');
      await sandbox.init();

      setupExecMock('', '', 0);
      await sandbox.writeFile('src/index.ts', 'console.log("hello");');

      expect(mockContainerExec).toHaveBeenCalledWith(
        expect.objectContaining({
          Cmd: expect.arrayContaining(['sh', '-c']),
          WorkingDir: '/workspace',
        }),
      );
    });
  });

  describe('readFile', () => {
    it('reads file content from container', async () => {
      const sandbox = new DockerSandbox('/tmp/workspace');
      await sandbox.init();

      setupExecMock('file content here', '', 0);
      const content = await sandbox.readFile('data.txt');
      expect(content).toBe('file content here');
    });

    it('throws when file does not exist', async () => {
      const sandbox = new DockerSandbox('/tmp/workspace');
      await sandbox.init();

      setupExecMock('', 'No such file or directory', 1);
      await expect(sandbox.readFile('missing.txt')).rejects.toThrow('Failed to read missing.txt');
    });
  });

  describe('exec', () => {
    it('runs command and returns result', async () => {
      const sandbox = new DockerSandbox('/tmp/workspace');
      await sandbox.init();

      setupExecMock('hello world\n', '', 0);
      const result = await sandbox.exec('echo', ['hello', 'world']);

      expect(result.stdout).toBe('hello world\n');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    });

    it('captures non-zero exit code', async () => {
      const sandbox = new DockerSandbox('/tmp/workspace');
      await sandbox.init();

      setupExecMock('', 'command not found', 127);
      const result = await sandbox.exec('nonexistent', []);

      expect(result.exitCode).toBe(127);
      expect(result.stderr).toBe('command not found');
    });

    it('captures both stdout and stderr', async () => {
      const sandbox = new DockerSandbox('/tmp/workspace');
      await sandbox.init();

      setupExecMock('output line', 'warning: deprecated', 0);
      const result = await sandbox.exec('node', ['script.js']);

      expect(result.stdout).toBe('output line');
      expect(result.stderr).toBe('warning: deprecated');
      expect(result.exitCode).toBe(0);
    });

    it('throws when sandbox not initialized', async () => {
      const sandbox = new DockerSandbox('/tmp/workspace');
      await expect(sandbox.exec('ls', ['-la'])).rejects.toThrow('Sandbox not initialized');
    });
  });

  describe('getWorkspacePath', () => {
    it('returns the host workspace path', () => {
      const sandbox = new DockerSandbox('/my/project');
      expect(sandbox.getWorkspacePath()).toBe('/my/project');
    });
  });

  describe('getImageDigest', () => {
    it('returns null before init', () => {
      const sandbox = new DockerSandbox('/tmp/workspace');
      expect(sandbox.getImageDigest()).toBeNull();
    });

    it('returns digest after init', async () => {
      const sandbox = new DockerSandbox('/tmp/workspace');
      await sandbox.init();
      expect(sandbox.getImageDigest()).toBe('sha256:abc123def456');
    });
  });

  describe('destroy', () => {
    it('stops and removes the container', async () => {
      const sandbox = new DockerSandbox('/tmp/workspace');
      await sandbox.init();
      await sandbox.destroy();

      expect(mockContainerStop).toHaveBeenCalledWith({ t: 2 });
      expect(mockContainerRemove).toHaveBeenCalledWith({ force: true });
    });

    it('handles stop failure gracefully (container already stopped)', async () => {
      mockContainerStop.mockRejectedValue(new Error('container not running'));

      const sandbox = new DockerSandbox('/tmp/workspace');
      await sandbox.init();
      await sandbox.destroy();

      expect(mockContainerRemove).toHaveBeenCalledWith({ force: true });
    });

    it('is safe to call when not initialized', async () => {
      const sandbox = new DockerSandbox('/tmp/workspace');
      await sandbox.destroy();
    });

    it('nullifies container reference after destroy', async () => {
      const sandbox = new DockerSandbox('/tmp/workspace');
      await sandbox.init();
      await sandbox.destroy();

      await expect(sandbox.exec('ls', [])).rejects.toThrow('Sandbox not initialized');
    });
  });

  describe('network isolation', () => {
    it('container is created with NetworkMode none by default', async () => {
      const sandbox = new DockerSandbox('/tmp/workspace');
      await sandbox.init();

      expect(mockCreateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            NetworkMode: 'none',
          }),
        }),
      );
    });
  });
});
