import { Command } from 'commander';
import { execSync } from 'node:child_process';

interface EnvironmentSnapshot {
  node_version: string;
  npm_version: string;
  platform: string;
  arch: string;
  timestamp: string;
}

function captureVersion(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function captureEnvironment(): EnvironmentSnapshot {
  return {
    node_version: captureVersion('node --version'),
    npm_version: captureVersion('npm --version'),
    platform: process.platform,
    arch: process.arch,
    timestamp: new Date().toISOString(),
  };
}

export const freezeCommand = new Command('freeze')
  .description('Capture current environment versions')
  .option('--json', 'Output as JSON')
  .action((opts) => {
    const env = captureEnvironment();
    if (opts.json) {
      console.log(JSON.stringify(env, null, 2));
    } else {
      console.log('Environment Snapshot');
      console.log('====================');
      console.log(`Node:      ${env.node_version}`);
      console.log(`npm:       ${env.npm_version}`);
      console.log(`Platform:  ${env.platform}`);
      console.log(`Arch:      ${env.arch}`);
      console.log(`Captured:  ${env.timestamp}`);
    }
  });
