import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { executeAssertions } from '../../src/core/asserter.js';
import { LocalSandbox } from '../../src/sandbox/local.js';
import type { EventLogger } from '../../src/core/logger.js';
import type { Assertion } from '../../src/types/assertion.js';
import { hashString } from '../../src/core/hasher.js';

let tempDir: string;
let workspace: string;
let sandbox: LocalSandbox;

const mockLogger: EventLogger = {
  log: vi.fn(),
  close: vi.fn(),
};

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'continuum-asserter-test-'));
  workspace = join(tempDir, 'workspace');
  sandbox = new LocalSandbox(workspace);
  await sandbox.init();
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const RUN_ID = 'test-run-asserter';

describe('exit_code assertions', () => {
  it('passes when exit code matches expected', async () => {
    const assertions: Assertion[] = [{
      assertion_id: 'ec-1',
      type: 'exit_code',
      description: 'node exits cleanly',
      spec: { type: 'exit_code', command: 'node', args: ['-e', 'process.exit(0)'], expected: 0 },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.passed).toBe(1);
    expect(result.total).toBe(1);
    expect(result.allRequiredPassed).toBe(true);
    expect(result.results[0].passed).toBe(true);
  });

  it('fails when exit code does not match', async () => {
    const assertions: Assertion[] = [{
      assertion_id: 'ec-2',
      type: 'exit_code',
      description: 'expect exit 0 but get 1',
      spec: { type: 'exit_code', command: 'node', args: ['-e', 'process.exit(1)'], expected: 0 },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.passed).toBe(0);
    expect(result.allRequiredPassed).toBe(false);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].actual).toContain('exit code 1');
  });

  it('can match non-zero expected exit code', async () => {
    const assertions: Assertion[] = [{
      assertion_id: 'ec-3',
      type: 'exit_code',
      description: 'expect exit 42',
      spec: { type: 'exit_code', command: 'node', args: ['-e', 'process.exit(42)'], expected: 42 },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(true);
  });
});

describe('file_exists assertions', () => {
  it('passes when file exists', async () => {
    await sandbox.writeFile('hello.txt', 'content');

    const assertions: Assertion[] = [{
      assertion_id: 'fe-1',
      type: 'file_exists',
      description: 'hello.txt exists',
      spec: { type: 'file_exists', path: 'hello.txt' },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(true);
  });

  it('fails when file does not exist', async () => {
    const assertions: Assertion[] = [{
      assertion_id: 'fe-2',
      type: 'file_exists',
      description: 'missing.txt exists',
      spec: { type: 'file_exists', path: 'missing.txt' },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].actual).toBe('not found');
  });
});

describe('file_hash assertions', () => {
  it('passes when hash matches', async () => {
    const content = 'deterministic content';
    const expectedHash = hashString(content);
    await sandbox.writeFile('data.txt', content);

    const assertions: Assertion[] = [{
      assertion_id: 'fh-1',
      type: 'file_hash',
      description: 'hash matches',
      spec: { type: 'file_hash', path: 'data.txt', expected_hash: expectedHash },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(true);
  });

  it('fails when hash differs', async () => {
    await sandbox.writeFile('data.txt', 'actual content');

    const assertions: Assertion[] = [{
      assertion_id: 'fh-2',
      type: 'file_hash',
      description: 'hash mismatch',
      spec: { type: 'file_hash', path: 'data.txt', expected_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(false);
  });
});

describe('file_contains assertions', () => {
  it('passes when file contains literal string', async () => {
    await sandbox.writeFile('app.js', 'const express = require("express");\napp.listen(3000);');

    const assertions: Assertion[] = [{
      assertion_id: 'fc-1',
      type: 'file_contains',
      description: 'contains express import',
      spec: { type: 'file_contains', path: 'app.js', pattern: 'require("express")', regex: false },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(true);
  });

  it('fails when pattern not found', async () => {
    await sandbox.writeFile('app.js', 'console.log("hello");');

    const assertions: Assertion[] = [{
      assertion_id: 'fc-2',
      type: 'file_contains',
      description: 'contains express',
      spec: { type: 'file_contains', path: 'app.js', pattern: 'express', regex: false },
      required: false,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(false);
  });

  it('supports regex matching', async () => {
    await sandbox.writeFile('version.txt', 'version: 3.14.159');

    const assertions: Assertion[] = [{
      assertion_id: 'fc-3',
      type: 'file_contains',
      description: 'version pattern',
      spec: { type: 'file_contains', path: 'version.txt', pattern: 'version:\\s+\\d+\\.\\d+\\.\\d+', regex: true },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(true);
  });
});

describe('command_output assertions', () => {
  it('passes when stdout contains expected string', async () => {
    const assertions: Assertion[] = [{
      assertion_id: 'co-1',
      type: 'command_output',
      description: 'node prints hello',
      spec: {
        type: 'command_output',
        command: 'node',
        args: ['-e', 'console.log("hello world")'],
        stdout_contains: 'hello world',
      },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(true);
  });

  it('fails when stdout does not contain expected string', async () => {
    const assertions: Assertion[] = [{
      assertion_id: 'co-2',
      type: 'command_output',
      description: 'node prints goodbye',
      spec: {
        type: 'command_output',
        command: 'node',
        args: ['-e', 'console.log("hello")'],
        stdout_contains: 'goodbye',
      },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(false);
  });

  it('supports stdout regex matching', async () => {
    const assertions: Assertion[] = [{
      assertion_id: 'co-3',
      type: 'command_output',
      description: 'node prints version-like string',
      spec: {
        type: 'command_output',
        command: 'node',
        args: ['-e', 'console.log("v20.11.0")'],
        stdout_regex: 'v\\d+\\.\\d+\\.\\d+',
      },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(true);
  });
});

describe('json_schema assertions', () => {
  it('passes for valid JSON object', async () => {
    await sandbox.writeFile('config.json', JSON.stringify({ name: 'test', version: 1 }));

    const assertions: Assertion[] = [{
      assertion_id: 'js-1',
      type: 'json_schema',
      description: 'config.json is valid JSON',
      spec: { type: 'json_schema', path: 'config.json', schema: { type: 'object' } },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(true);
  });

  it('fails for invalid JSON', async () => {
    await sandbox.writeFile('bad.json', 'not json at all');

    const assertions: Assertion[] = [{
      assertion_id: 'js-2',
      type: 'json_schema',
      description: 'bad.json is valid JSON',
      spec: { type: 'json_schema', path: 'bad.json', schema: { type: 'object' } },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].actual).toContain('parse failed');
  });
});

describe('http_response assertions', () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    // Create a real HTTP server for testing
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else if (req.url === '/data') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Hello from server');
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    // Start server and get the assigned port
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('passes when HTTP status matches expected', async () => {
    const assertions: Assertion[] = [{
      assertion_id: 'http-1',
      type: 'http_response',
      description: 'health endpoint returns 200',
      spec: {
        type: 'http_response',
        method: 'GET',
        url: `http://127.0.0.1:${port}/health`,
        expected_status: 200,
      },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(true);
    expect(result.results[0].actual).toBe('HTTP 200');
  });

  it('fails when HTTP status does not match', async () => {
    const assertions: Assertion[] = [{
      assertion_id: 'http-2',
      type: 'http_response',
      description: 'missing endpoint returns 200',
      spec: {
        type: 'http_response',
        method: 'GET',
        url: `http://127.0.0.1:${port}/nonexistent`,
        expected_status: 200,
      },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].actual).toBe('HTTP 404');
  });

  it('checks body_contains when specified', async () => {
    const assertions: Assertion[] = [{
      assertion_id: 'http-3',
      type: 'http_response',
      description: 'data endpoint contains hello',
      spec: {
        type: 'http_response',
        method: 'GET',
        url: `http://127.0.0.1:${port}/data`,
        expected_status: 200,
        body_contains: 'Hello from server',
      },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(true);
  });

  it('fails when body_contains not found', async () => {
    const assertions: Assertion[] = [{
      assertion_id: 'http-4',
      type: 'http_response',
      description: 'data endpoint contains xyz',
      spec: {
        type: 'http_response',
        method: 'GET',
        url: `http://127.0.0.1:${port}/data`,
        expected_status: 200,
        body_contains: 'xyz not here',
      },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].diff).toContain('Body missing');
  });

  it('handles connection refused gracefully', async () => {
    const assertions: Assertion[] = [{
      assertion_id: 'http-5',
      type: 'http_response',
      description: 'unreachable server',
      spec: {
        type: 'http_response',
        method: 'GET',
        url: 'http://127.0.0.1:1/should-fail',
        expected_status: 200,
      },
      required: false,
      stability: 'environmental',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].actual).toContain('request failed');
  });
});

describe('retry behavior', () => {
  it('retries flaky assertions up to max_attempts', async () => {
    // Use a file_exists assertion that fails — will be retried 3 times for flaky
    const assertions: Assertion[] = [{
      assertion_id: 'retry-1',
      type: 'file_exists',
      description: 'file that never appears',
      spec: { type: 'file_exists', path: 'never-created.txt' },
      required: false,
      stability: 'flaky',
      retry: { max_attempts: 2, backoff_ms: 100 },
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].attempts).toBe(2);
  });

  it('succeeds on first try for stable assertions', async () => {
    await sandbox.writeFile('exists.txt', 'yes');

    const assertions: Assertion[] = [{
      assertion_id: 'retry-2',
      type: 'file_exists',
      description: 'existing file',
      spec: { type: 'file_exists', path: 'exists.txt' },
      required: true,
      stability: 'stable',
    }];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.results[0].attempts).toBe(1);
  });
});

describe('multiple assertions', () => {
  it('runs all assertions and reports aggregate', async () => {
    await sandbox.writeFile('index.js', 'console.log("hello");');

    const assertions: Assertion[] = [
      {
        assertion_id: 'multi-1',
        type: 'file_exists',
        description: 'index.js exists',
        spec: { type: 'file_exists', path: 'index.js' },
        required: true,
        stability: 'stable',
      },
      {
        assertion_id: 'multi-2',
        type: 'file_contains',
        description: 'index.js has hello',
        spec: { type: 'file_contains', path: 'index.js', pattern: 'hello', regex: false },
        required: true,
        stability: 'stable',
      },
      {
        assertion_id: 'multi-3',
        type: 'file_exists',
        description: 'missing file',
        spec: { type: 'file_exists', path: 'not-here.txt' },
        required: false,
        stability: 'stable',
      },
    ];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.total).toBe(3);
    expect(result.passed).toBe(2);
    expect(result.allRequiredPassed).toBe(true); // the failed one is not required
  });

  it('allRequiredPassed is false when required assertion fails', async () => {
    const assertions: Assertion[] = [
      {
        assertion_id: 'req-1',
        type: 'file_exists',
        description: 'required file missing',
        spec: { type: 'file_exists', path: 'required.txt' },
        required: true,
        stability: 'stable',
      },
    ];

    const result = await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);
    expect(result.allRequiredPassed).toBe(false);
  });
});

describe('event logging', () => {
  it('logs assertion_started and assertion_passed events', async () => {
    await sandbox.writeFile('file.txt', 'content');

    const assertions: Assertion[] = [{
      assertion_id: 'log-1',
      type: 'file_exists',
      description: 'file exists',
      spec: { type: 'file_exists', path: 'file.txt' },
      required: true,
      stability: 'stable',
    }];

    await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);

    const loggedEvents = (mockLogger.log as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => (call[0] as { type: string }).type,
    );
    expect(loggedEvents).toContain('assertion_started');
    expect(loggedEvents).toContain('assertion_passed');
  });

  it('logs assertion_failed event on failure', async () => {
    const assertions: Assertion[] = [{
      assertion_id: 'log-2',
      type: 'file_exists',
      description: 'missing file',
      spec: { type: 'file_exists', path: 'nope.txt' },
      required: true,
      stability: 'stable',
    }];

    await executeAssertions(assertions, sandbox, mockLogger, RUN_ID);

    const loggedEvents = (mockLogger.log as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => (call[0] as { type: string }).type,
    );
    expect(loggedEvents).toContain('assertion_failed');
  });
});
