import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CONFIG_FILENAME = '.continuumrc.json';

/** Webhook endpoint configuration */
export interface WebhookConfigEntry {
  url: string;
  events?: string[];
  secret?: string;
  timeout_ms?: number;
}

/** Continuum runtime configuration */
export interface ContinuumConfig {
  model?: string;
  workspace_dir?: string;
  sandbox?: 'local' | 'docker';
  docker_image?: string;
  cache?: { ttl_ms?: number };
  execution?: { max_concurrency?: number; default_timeout_ms?: number };
  repair?: {
    enabled_levels?: (1 | 2 | 3)[];
    timeout_ms?: number;
    max_tokens?: number;
  };
  retention?: {
    max_runs?: number;
    max_age_days?: number;
  };
  assertions?: {
    default_timeout_ms?: number;
    max_retries?: number;
  };
  webhooks?: WebhookConfigEntry[];
  /** Named environment profiles. Each profile overrides the base config. */
  profiles?: Record<string, ContinuumConfig>;
}

/** Fully resolved config with all defaults applied */
export interface ResolvedConfig {
  model: string;
  workspace_dir: string | undefined;
  sandbox: 'local' | 'docker';
  docker_image: string;
  cache: { ttl_ms: number };
  execution: { max_concurrency: number; default_timeout_ms: number };
  repair: {
    enabled_levels: (1 | 2 | 3)[];
    timeout_ms: number;
    max_tokens: number;
  };
  retention: {
    max_runs: number;
    max_age_days: number;
  };
  assertions: {
    default_timeout_ms: number;
    max_retries: number;
  };
  webhooks: WebhookConfigEntry[];
}

export const DEFAULT_CONFIG: ResolvedConfig = {
  model: 'claude-sonnet-4-20250514',
  workspace_dir: undefined,
  sandbox: 'local',
  docker_image: 'node:20-slim',
  cache: { ttl_ms: 7 * 24 * 60 * 60 * 1000 },
  execution: { max_concurrency: 4, default_timeout_ms: 120_000 },
  repair: {
    enabled_levels: [1, 2, 3],
    timeout_ms: 30_000,
    max_tokens: 4096,
  },
  retention: {
    max_runs: 100,
    max_age_days: 30,
  },
  assertions: {
    default_timeout_ms: 10_000,
    max_retries: 2,
  },
  webhooks: [],
};

/**
 * Find .continuumrc.json by walking up from startDir.
 */
export function findConfigFile(startDir?: string): string | null {
  let dir = resolve(startDir ?? process.cwd());
  const root = resolve('/');

  while (dir !== root) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  // Check root too
  const rootCandidate = join(root, CONFIG_FILENAME);
  if (existsSync(rootCandidate)) return rootCandidate;

  return null;
}

/**
 * Load config from file. Returns empty config if file not found.
 */
export function loadConfigFile(configPath?: string): ContinuumConfig {
  const path = configPath ?? findConfigFile();
  if (!path) return {};

  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Config must be a JSON object');
    }
    return parsed as ContinuumConfig;
  } catch (err: unknown) {
    if (configPath) {
      // Explicit path: throw
      throw new Error(`Failed to load config from ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Auto-discovered: warn and use defaults
    return {};
  }
}

/**
 * Get the list of available profile names from a config.
 */
export function listProfiles(config: ContinuumConfig): string[] {
  return Object.keys(config.profiles ?? {});
}

/**
 * Resolve final config by merging defaults + file config + profile + CLI overrides.
 */
export function resolveConfig(
  fileConfig: ContinuumConfig,
  cliOverrides?: Partial<ContinuumConfig>,
  profileName?: string,
): ResolvedConfig {
  let merged: ContinuumConfig = { ...fileConfig };
  // Strip profiles from merged to avoid infinite nesting
  delete merged.profiles;

  // Apply profile if specified
  if (profileName && fileConfig.profiles) {
    const profile = fileConfig.profiles[profileName];
    if (!profile) {
      throw new Error(`Unknown profile "${profileName}". Available: ${listProfiles(fileConfig).join(', ') || '(none)'}`);
    }
    merged = mergeConfigs(merged, profile);
  }

  // Apply CLI overrides (non-undefined values only)
  if (cliOverrides) {
    if (cliOverrides.model !== undefined) merged.model = cliOverrides.model;
    if (cliOverrides.workspace_dir !== undefined) merged.workspace_dir = cliOverrides.workspace_dir;
    if (cliOverrides.sandbox !== undefined) merged.sandbox = cliOverrides.sandbox;
    if (cliOverrides.docker_image !== undefined) merged.docker_image = cliOverrides.docker_image;
    if (cliOverrides.cache) merged.cache = { ...merged.cache, ...cliOverrides.cache };
    if (cliOverrides.execution) merged.execution = { ...merged.execution, ...cliOverrides.execution };
    if (cliOverrides.repair) merged.repair = { ...merged.repair, ...cliOverrides.repair };
    if (cliOverrides.retention) merged.retention = { ...merged.retention, ...cliOverrides.retention };
    if (cliOverrides.assertions) merged.assertions = { ...merged.assertions, ...cliOverrides.assertions };
  }

  return {
    model: merged.model ?? DEFAULT_CONFIG.model,
    workspace_dir: merged.workspace_dir ?? DEFAULT_CONFIG.workspace_dir,
    sandbox: merged.sandbox ?? DEFAULT_CONFIG.sandbox,
    docker_image: merged.docker_image ?? DEFAULT_CONFIG.docker_image,
    cache: { ...DEFAULT_CONFIG.cache, ...merged.cache },
    execution: { ...DEFAULT_CONFIG.execution, ...merged.execution },
    repair: { ...DEFAULT_CONFIG.repair, ...merged.repair },
    retention: { ...DEFAULT_CONFIG.retention, ...merged.retention },
    assertions: { ...DEFAULT_CONFIG.assertions, ...merged.assertions },
    webhooks: merged.webhooks ?? DEFAULT_CONFIG.webhooks,
  };
}

/**
 * Merge two configs, with overlay taking precedence.
 */
function mergeConfigs(base: ContinuumConfig, overlay: ContinuumConfig): ContinuumConfig {
  const result: ContinuumConfig = { ...base };

  if (overlay.model !== undefined) result.model = overlay.model;
  if (overlay.workspace_dir !== undefined) result.workspace_dir = overlay.workspace_dir;
  if (overlay.sandbox !== undefined) result.sandbox = overlay.sandbox;
  if (overlay.docker_image !== undefined) result.docker_image = overlay.docker_image;
  if (overlay.cache) result.cache = { ...result.cache, ...overlay.cache };
  if (overlay.execution) result.execution = { ...result.execution, ...overlay.execution };
  if (overlay.repair) result.repair = { ...result.repair, ...overlay.repair };
  if (overlay.retention) result.retention = { ...result.retention, ...overlay.retention };
  if (overlay.assertions) result.assertions = { ...result.assertions, ...overlay.assertions };
  if (overlay.webhooks) result.webhooks = overlay.webhooks;

  return result;
}

/**
 * One-shot: load file + resolve with defaults.
 */
export function loadConfig(configPath?: string, profileName?: string): ResolvedConfig {
  const fileConfig = loadConfigFile(configPath);
  return resolveConfig(fileConfig, undefined, profileName);
}
