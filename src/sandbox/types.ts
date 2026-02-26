/** Result of executing a command in the sandbox */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Abstract sandbox environment for step execution.
 * Implementations provide isolated filesystems and command execution.
 */
export interface Sandbox {
  /** Initialize the sandbox (create container, temp dir, etc.) */
  init(): Promise<void>;

  /** Write a file inside the sandbox workspace */
  writeFile(relativePath: string, content: string): Promise<void>;

  /** Read a file from the sandbox workspace */
  readFile(relativePath: string): Promise<string>;

  /** Execute a command inside the sandbox */
  exec(command: string, args: string[]): Promise<ExecResult>;

  /** Get the absolute workspace path inside the sandbox */
  getWorkspacePath(): string;

  /** Tear down the sandbox (remove container, clean up) */
  destroy(): Promise<void>;
}
