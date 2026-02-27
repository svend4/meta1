import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getBaseDir, getRunsDir, getPlanCacheDir, getGenerationsDir } from './paths.js';
import { findConfigFile, loadConfig } from './config.js';
import { getCacheStats } from './plan-cache.js';
import { listRunIds } from '../storage/runs.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  passed: number;
  warnings: number;
  failed: number;
}

/**
 * Run all diagnostic checks and return a report.
 */
export function runDoctor(): DoctorReport {
  const checks: DoctorCheck[] = [
    checkNodeVersion(),
    checkStorageDir(),
    checkConfig(),
    checkPlanCache(),
    checkRunHistory(),
    checkDocker(),
    checkApiKey(),
  ];

  return {
    checks,
    passed: checks.filter((c) => c.status === 'ok').length,
    warnings: checks.filter((c) => c.status === 'warn').length,
    failed: checks.filter((c) => c.status === 'fail').length,
  };
}

function checkNodeVersion(): DoctorCheck {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);

  if (major >= 20) {
    return { name: 'Node.js version', status: 'ok', message: version };
  }
  if (major >= 18) {
    return {
      name: 'Node.js version',
      status: 'warn',
      message: `${version} (recommended: >=20.0.0)`,
    };
  }
  return {
    name: 'Node.js version',
    status: 'fail',
    message: `${version} (required: >=20.0.0)`,
  };
}

function checkStorageDir(): DoctorCheck {
  const baseDir = getBaseDir();
  const runsDir = getRunsDir();
  const cacheDir = getPlanCacheDir();
  const genDir = getGenerationsDir();

  const dirs = [
    { name: 'base', path: baseDir },
    { name: 'runs', path: runsDir },
    { name: 'cache', path: cacheDir },
    { name: 'generations', path: genDir },
  ];

  const existing = dirs.filter((d) => existsSync(d.path));
  const missing = dirs.filter((d) => !existsSync(d.path));

  if (missing.length === dirs.length) {
    return {
      name: 'Storage directory',
      status: 'warn',
      message: `Not initialized (${baseDir})`,
      detail: 'Will be created on first run.',
    };
  }

  // Check writability
  try {
    const stat = statSync(baseDir);
    if (!stat.isDirectory()) {
      return {
        name: 'Storage directory',
        status: 'fail',
        message: `${baseDir} exists but is not a directory`,
      };
    }
  } catch {
    return {
      name: 'Storage directory',
      status: 'fail',
      message: `Cannot access ${baseDir}`,
    };
  }

  return {
    name: 'Storage directory',
    status: 'ok',
    message: `${baseDir} (${existing.length}/${dirs.length} subdirs)`,
  };
}

function checkConfig(): DoctorCheck {
  const configPath = findConfigFile();
  if (!configPath) {
    return {
      name: 'Configuration',
      status: 'warn',
      message: 'No .continuumrc.json found (using defaults)',
    };
  }

  try {
    const config = loadConfig(configPath);
    return {
      name: 'Configuration',
      status: 'ok',
      message: `Loaded from ${configPath}`,
      detail: `model=${config.model}, sandbox=${config.sandbox}`,
    };
  } catch (err: unknown) {
    return {
      name: 'Configuration',
      status: 'fail',
      message: `Invalid config: ${err instanceof Error ? err.message : String(err)}`,
      detail: configPath,
    };
  }
}

function checkPlanCache(): DoctorCheck {
  try {
    const stats = getCacheStats();
    return {
      name: 'Plan cache',
      status: 'ok',
      message: `${stats.entries} plan(s) cached`,
    };
  } catch {
    return {
      name: 'Plan cache',
      status: 'warn',
      message: 'Cache directory not initialized',
    };
  }
}

function checkRunHistory(): DoctorCheck {
  try {
    const ids = listRunIds();
    return {
      name: 'Run history',
      status: 'ok',
      message: `${ids.length} run(s)`,
    };
  } catch {
    return {
      name: 'Run history',
      status: 'warn',
      message: 'No runs yet',
    };
  }
}

function checkDocker(): DoctorCheck {
  try {
    const output = execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();

    return {
      name: 'Docker',
      status: 'ok',
      message: `Server ${output}`,
    };
  } catch {
    return {
      name: 'Docker',
      status: 'warn',
      message: 'Not available (local sandbox only)',
      detail: 'Install Docker for isolated execution.',
    };
  }
}

function checkApiKey(): DoctorCheck {
  const key = process.env['ANTHROPIC_API_KEY'];
  if (!key) {
    return {
      name: 'API key',
      status: 'warn',
      message: 'ANTHROPIC_API_KEY not set',
      detail: 'Required for LLM plan generation and repair.',
    };
  }

  const masked = key.slice(0, 10) + '...' + key.slice(-4);
  return {
    name: 'API key',
    status: 'ok',
    message: `Set (${masked})`,
  };
}
