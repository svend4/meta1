import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { getFreezeDir } from '../core/paths.js';

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

export interface PlanTag {
  tag: string;
  plan_hash: string;
  created_at: string;
  environment: EnvironmentSnapshot;
  description?: string;
}

function getTagsDir(): string {
  return join(getFreezeDir(), 'tags');
}

function getTagPath(tag: string): string {
  return join(getTagsDir(), `${tag}.json`);
}

function saveTag(tagData: PlanTag): void {
  const dir = getTagsDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getTagPath(tagData.tag), JSON.stringify(tagData, null, 2), 'utf8');
}

export function loadTag(tag: string): PlanTag | null {
  const path = getTagPath(tag);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function listTags(): PlanTag[] {
  const dir = getTagsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as PlanTag)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function resolveTagOrHash(input: string): string {
  // If it looks like a sha256 hash, return as-is
  if (input.startsWith('sha256:') || input.length === 64) {
    return input;
  }
  // Try to resolve as tag
  const tag = loadTag(input);
  if (tag) return tag.plan_hash;
  return input;
}

export const freezeCommand = new Command('freeze')
  .description('Capture environment snapshot or tag a plan generation')
  .argument('[plan_hash]', 'Plan hash to tag (optional)')
  .option('--tag <name>', 'Tag name (e.g., v1.0, stable, baseline)')
  .option('--description <text>', 'Description for the tag')
  .option('--json', 'Output as JSON')
  .option('--list', 'List all tags')
  .action((planHash: string | undefined, opts: {
    tag?: string;
    description?: string;
    json?: boolean;
    list?: boolean;
  }) => {
    // List all tags
    if (opts.list) {
      const tags = listTags();
      if (tags.length === 0) {
        console.log('No tags found.');
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify(tags, null, 2));
        return;
      }
      console.log(chalk.blue('Plan Tags'));
      console.log(chalk.gray('═'.repeat(60)));
      for (const t of tags) {
        console.log(`  ${chalk.cyan(t.tag)} → ${chalk.gray(t.plan_hash.slice(0, 19))}...`);
        if (t.description) console.log(`    ${chalk.gray(t.description)}`);
        console.log(`    ${chalk.gray(`Created: ${t.created_at}`)}`);
      }
      return;
    }

    // Tag a plan
    if (opts.tag && planHash) {
      const existing = loadTag(opts.tag);
      if (existing) {
        console.error(chalk.red(`Tag "${opts.tag}" already exists (plan: ${existing.plan_hash.slice(0, 19)}...).`));
        console.error(chalk.yellow('Tags are immutable. Choose a different name.'));
        process.exit(1);
      }

      const tagData: PlanTag = {
        tag: opts.tag,
        plan_hash: planHash,
        created_at: new Date().toISOString(),
        environment: captureEnvironment(),
        description: opts.description,
      };

      saveTag(tagData);

      if (opts.json) {
        console.log(JSON.stringify(tagData, null, 2));
      } else {
        console.log(chalk.green(`Tagged ${planHash.slice(0, 19)}... as "${opts.tag}"`));
        if (opts.description) console.log(chalk.gray(`  Description: ${opts.description}`));
      }
      return;
    }

    // Default: show environment snapshot
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
