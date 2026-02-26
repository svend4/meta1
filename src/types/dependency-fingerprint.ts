/** Structured snapshot of tool versions, lockfile state, and sandbox image */
export interface DependencyFingerprint {
  fingerprint_id: string;
  captured_at: string;
  fingerprint_hash: `sha256:${string}`;

  tools: {
    node: string;
    npm: string;
    git?: string;
    docker?: string;
  };

  lockfile?: {
    path: string;
    hash: `sha256:${string}`;
    format: 'npm' | 'pnpm' | 'yarn';
  };

  dependency_tree?: {
    hash: `sha256:${string}`;
    top_level_count: number;
  };

  sandbox_image?: {
    name: string;
    digest: string;
  };
}
