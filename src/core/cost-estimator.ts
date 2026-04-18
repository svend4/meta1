/**
 * Step cost estimator — estimate execution cost and time before running,
 * based on step type, content size, and historical run data.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getBaseDir } from './paths.js';
import type { ExecutionPlan, Step } from '../types/execution-plan.js';

/** Cost estimate for a single step */
export interface StepCostEstimate {
  stepId: string;
  type: string;
  /** Estimated duration in milliseconds */
  estimatedMs: number;
  /** Confidence level (0-1) */
  confidence: number;
  /** Basis for the estimate */
  basis: 'historical' | 'heuristic' | 'default';
  /** Estimated I/O cost (file size in bytes, or 0 for commands) */
  ioCostBytes: number;
}

/** Cost estimate for an entire plan */
export interface PlanCostEstimate {
  planId: string;
  steps: StepCostEstimate[];
  /** Total estimated duration (sequential execution) */
  totalSequentialMs: number;
  /** Total estimated duration (parallel execution, critical path) */
  totalParallelMs: number;
  /** Total I/O cost */
  totalIOBytes: number;
  /** Overall confidence */
  confidence: number;
}

/** Historical step timing data */
export interface StepTimingRecord {
  command: string;
  avgMs: number;
  samples: number;
  lastUpdated: string;
}

function getTimingsPath(): string {
  return join(getBaseDir(), 'step-timings.json');
}

/**
 * Load historical step timings.
 */
export function loadTimings(): Map<string, StepTimingRecord> {
  const path = getTimingsPath();
  if (!existsSync(path)) return new Map();

  const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, StepTimingRecord>;
  return new Map(Object.entries(data));
}

/**
 * Record a step timing observation.
 */
export function recordTiming(command: string, durationMs: number): void {
  const timings = loadTimings();
  const existing = timings.get(command);

  if (existing) {
    const newSamples = existing.samples + 1;
    existing.avgMs = (existing.avgMs * existing.samples + durationMs) / newSamples;
    existing.samples = newSamples;
    existing.lastUpdated = new Date().toISOString();
  } else {
    timings.set(command, {
      command,
      avgMs: durationMs,
      samples: 1,
      lastUpdated: new Date().toISOString(),
    });
  }

  saveTimings(timings);
}

/**
 * Estimate cost for a single step.
 */
export function estimateStepCost(step: Step, timings?: Map<string, StepTimingRecord>): StepCostEstimate {
  const t = timings ?? loadTimings();

  if (step.type === 'create_file') {
    const sizeBytes = Buffer.byteLength(step.content, 'utf8');
    // File creation is fast: ~1ms per KB, minimum 5ms
    const estimatedMs = Math.max(5, Math.ceil(sizeBytes / 1024));
    return {
      stepId: step.step_id,
      type: 'create_file',
      estimatedMs,
      confidence: 0.9,
      basis: 'heuristic',
      ioCostBytes: sizeBytes,
    };
  }

  // run_command
  if (step.type === 'run_command') {
    const key = step.command;
    const historical = t.get(key);

    if (historical && historical.samples >= 3) {
      return {
        stepId: step.step_id,
        type: 'run_command',
        estimatedMs: Math.round(historical.avgMs),
        confidence: Math.min(0.95, 0.5 + historical.samples * 0.05),
        basis: 'historical',
        ioCostBytes: 0,
      };
    }

    // Heuristic estimates for common commands
    const heuristic = getCommandHeuristic(step.command, step.args);
    if (heuristic) {
      return {
        stepId: step.step_id,
        type: 'run_command',
        estimatedMs: heuristic.ms,
        confidence: heuristic.confidence,
        basis: 'heuristic',
        ioCostBytes: 0,
      };
    }

    // Default: unknown command
    return {
      stepId: step.step_id,
      type: 'run_command',
      estimatedMs: 5000,
      confidence: 0.1,
      basis: 'default',
      ioCostBytes: 0,
    };
  }

  // Exhaustive fallback
  const _exhaustive: never = step;
  return _exhaustive;
}

/**
 * Estimate cost for an entire plan.
 */
export function estimatePlanCost(plan: ExecutionPlan): PlanCostEstimate {
  const timings = loadTimings();
  const steps = plan.steps.map((s) => estimateStepCost(s, timings));

  const totalSequentialMs = steps.reduce((sum, s) => sum + s.estimatedMs, 0);
  const totalIOBytes = steps.reduce((sum, s) => sum + s.ioCostBytes, 0);
  const avgConfidence = steps.length > 0
    ? steps.reduce((sum, s) => sum + s.confidence, 0) / steps.length
    : 0;

  // Critical path for parallel execution
  const totalParallelMs = computeCriticalPath(plan, steps);

  return {
    planId: plan.plan_id,
    steps,
    totalSequentialMs,
    totalParallelMs,
    totalIOBytes,
    confidence: Math.round(avgConfidence * 100) / 100,
  };
}

/**
 * Format a plan cost estimate for display.
 */
export function formatCostEstimate(estimate: PlanCostEstimate): string {
  const lines: string[] = [];

  lines.push('Cost Estimate');
  lines.push(`  Plan: ${estimate.planId}`);
  lines.push(`  Sequential: ${formatDuration(estimate.totalSequentialMs)}`);
  lines.push(`  Parallel: ${formatDuration(estimate.totalParallelMs)}`);
  lines.push(`  I/O: ${formatBytes(estimate.totalIOBytes)}`);
  lines.push(`  Confidence: ${(estimate.confidence * 100).toFixed(0)}%`);
  lines.push('');

  for (const s of estimate.steps) {
    const conf = `${(s.confidence * 100).toFixed(0)}%`;
    lines.push(`  ${s.stepId.padEnd(25)} ${formatDuration(s.estimatedMs).padEnd(10)} ${conf.padEnd(5)} (${s.basis})`);
  }

  return lines.join('\n');
}

// ── Internal ──

function saveTimings(timings: Map<string, StepTimingRecord>): void {
  const dir = getBaseDir();
  mkdirSync(dir, { recursive: true });
  const data = Object.fromEntries(timings);
  writeFileSync(getTimingsPath(), JSON.stringify(data, null, 2), 'utf8');
}

function getCommandHeuristic(command: string, args: string[]): { ms: number; confidence: number } | null {
  const cmd = command.toLowerCase();
  const joined = args.join(' ').toLowerCase();

  if (cmd === 'echo' || cmd === 'printf') return { ms: 10, confidence: 0.95 };
  if (cmd === 'mkdir' || cmd === 'rm' || cmd === 'cp' || cmd === 'mv') return { ms: 50, confidence: 0.8 };
  if (cmd === 'chmod' || cmd === 'chown') return { ms: 20, confidence: 0.9 };
  if (cmd === 'npm' && joined.includes('install')) return { ms: 30000, confidence: 0.3 };
  if (cmd === 'npm' && joined.includes('build')) return { ms: 15000, confidence: 0.3 };
  if (cmd === 'npm' && joined.includes('test')) return { ms: 20000, confidence: 0.2 };
  if (cmd === 'npm' && joined.includes('run')) return { ms: 10000, confidence: 0.2 };
  if (cmd === 'npx') return { ms: 10000, confidence: 0.2 };
  if (cmd === 'git') return { ms: 500, confidence: 0.5 };
  if (cmd === 'pip' || cmd === 'pip3') return { ms: 20000, confidence: 0.3 };
  if (cmd === 'python' || cmd === 'python3') return { ms: 5000, confidence: 0.2 };
  if (cmd === 'node') return { ms: 3000, confidence: 0.2 };
  if (cmd === 'cargo') return { ms: 30000, confidence: 0.2 };
  if (cmd === 'go') return { ms: 10000, confidence: 0.2 };

  return null;
}

function computeCriticalPath(plan: ExecutionPlan, estimates: StepCostEstimate[]): number {
  if (plan.execution_mode !== 'parallel') return estimates.reduce((s, e) => s + e.estimatedMs, 0);

  const costMap = new Map(estimates.map((e) => [e.stepId, e.estimatedMs]));
  const earliest = new Map<string, number>();

  // Topological order
  const stepMap = new Map(plan.steps.map((s) => [s.step_id, s]));

  function getEarliest(stepId: string): number {
    if (earliest.has(stepId)) return earliest.get(stepId)!;

    const step = stepMap.get(stepId);
    if (!step) return 0;

    const deps = step.depends_on ?? [];
    const maxDepEnd = deps.length > 0
      ? Math.max(...deps.map((d) => getEarliest(d) + (costMap.get(d) ?? 0)))
      : 0;

    earliest.set(stepId, maxDepEnd);
    return maxDepEnd;
  }

  let maxEnd = 0;
  for (const step of plan.steps) {
    const start = getEarliest(step.step_id);
    const end = start + (costMap.get(step.step_id) ?? 0);
    if (end > maxEnd) maxEnd = end;
  }

  return maxEnd;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
