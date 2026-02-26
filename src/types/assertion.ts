/** Assertion stability classification */
export type AssertionStability = 'stable' | 'flaky' | 'environmental';

/** Assertion type discriminator */
export type AssertionType =
  | 'exit_code'
  | 'file_exists'
  | 'file_hash'
  | 'file_contains'
  | 'command_output'
  | 'http_response'
  | 'json_schema';

/** Retry policy for assertions */
export interface RetryPolicy {
  max_attempts: number;
  backoff_ms: number;
}

/** A semantic correctness check */
export interface Assertion {
  assertion_id: string;
  type: AssertionType;
  description: string;
  spec: AssertionSpec;
  required: boolean;
  stability: AssertionStability;
  retry?: RetryPolicy;
}

/** Union of all assertion spec types */
export type AssertionSpec =
  | ExitCodeAssertionSpec
  | FileExistsAssertionSpec
  | FileHashAssertionSpec
  | FileContainsAssertionSpec
  | CommandOutputAssertionSpec
  | HttpResponseAssertionSpec
  | JsonSchemaAssertionSpec;

export interface ExitCodeAssertionSpec {
  type: 'exit_code';
  command: string;
  args: string[];
  expected: number;
}

export interface FileExistsAssertionSpec {
  type: 'file_exists';
  path: string;
}

export interface FileHashAssertionSpec {
  type: 'file_hash';
  path: string;
  expected_hash: `sha256:${string}`;
}

export interface FileContainsAssertionSpec {
  type: 'file_contains';
  path: string;
  pattern: string;
  regex: boolean;
}

export interface CommandOutputAssertionSpec {
  type: 'command_output';
  command: string;
  args: string[];
  stdout_contains?: string;
  stdout_regex?: string;
}

export interface HttpResponseAssertionSpec {
  type: 'http_response';
  method: string;
  url: string;
  expected_status: number;
  body_contains?: string;
  startup_command?: string;
  startup_timeout_ms?: number;
  shutdown_after?: boolean;
}

export interface JsonSchemaAssertionSpec {
  type: 'json_schema';
  path: string;
  schema: object;
}

/** Result of executing a single assertion */
export interface AssertionResult {
  assertion_id: string;
  type: AssertionType;
  stability: AssertionStability;
  passed: boolean;
  attempts: number;
  duration_ms: number;
  expected: string;
  actual: string;
  diff?: string;
}
