import type { ExecutionPlan, Step, CreateFileStep, RunCommandStep } from '../types/execution-plan.js';
import { dirname } from 'node:path';

/** Severity of a lint finding */
export type LintSeverity = 'error' | 'warning' | 'info';

/** A single lint finding */
export interface LintFinding {
  rule: string;
  severity: LintSeverity;
  message: string;
  stepId?: string;
}

/** Result of linting a plan */
export interface LintResult {
  findings: LintFinding[];
  errors: number;
  warnings: number;
  infos: number;
  passed: boolean;
}

/** Commands considered dangerous without explicit user intent */
const UNSAFE_COMMANDS = new Set([
  'rm', 'rmdir', 'del', 'format', 'mkfs',
  'dd', 'chmod', 'chown', 'kill', 'pkill', 'killall',
  'shutdown', 'reboot', 'halt', 'poweroff',
]);

/** Dangerous argument patterns */
const UNSAFE_ARG_PATTERNS = [
  /^-rf$/,
  /^--force$/,
  /^-.*f.*r|r.*f/,  // rm -rf variants
  /^\/$/,            // root path
  /^~$/,             // home dir
  /^\.\.\/?$/,       // parent dir
];

/** Commands that typically install dependencies */
const INSTALL_COMMANDS: Array<{ command: string; args: string[] }> = [
  { command: 'npm', args: ['install'] },
  { command: 'npm', args: ['ci'] },
  { command: 'yarn', args: ['install'] },
  { command: 'yarn', args: ['add'] },
  { command: 'pip', args: ['install'] },
  { command: 'pip3', args: ['install'] },
];

/**
 * Lint an execution plan for common mistakes and safety issues.
 */
export function lintPlan(plan: ExecutionPlan): LintResult {
  const findings: LintFinding[] = [];

  // Global checks
  checkDuplicateStepIds(plan.steps, findings);
  checkEmptyPlan(plan, findings);
  checkFileConflicts(plan.steps, findings);
  checkMissingInstallBeforeRun(plan.steps, findings);
  checkDependencyReferences(plan.steps, findings);

  // Per-step checks
  for (const step of plan.steps) {
    if (step.type === 'run_command') {
      checkUnsafeCommand(step, findings);
      checkEmptyCommand(step, findings);
      checkSuspiciousShell(step, findings);
    }
    if (step.type === 'create_file') {
      checkLargeFileContent(step, findings);
      checkAbsolutePath(step, findings);
      checkParentDirCreation(step, plan.steps, findings);
    }
    checkEmptyDescription(step, findings);
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const infos = findings.filter((f) => f.severity === 'info').length;

  return {
    findings,
    errors,
    warnings,
    infos,
    passed: errors === 0,
  };
}

function checkDuplicateStepIds(steps: Step[], findings: LintFinding[]): void {
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.step_id)) {
      findings.push({
        rule: 'duplicate-step-id',
        severity: 'error',
        message: `Duplicate step_id: "${step.step_id}"`,
        stepId: step.step_id,
      });
    }
    seen.add(step.step_id);
  }
}

function checkEmptyPlan(plan: ExecutionPlan, findings: LintFinding[]): void {
  if (plan.steps.length === 0) {
    findings.push({
      rule: 'empty-plan',
      severity: 'warning',
      message: 'Plan has no steps',
    });
  }
}

function checkFileConflicts(steps: Step[], findings: LintFinding[]): void {
  const filePaths = new Map<string, string>();
  for (const step of steps) {
    if (step.type === 'create_file') {
      const existing = filePaths.get(step.path);
      if (existing) {
        findings.push({
          rule: 'file-conflict',
          severity: 'warning',
          message: `File "${step.path}" is created by both "${existing}" and "${step.step_id}" — last write wins`,
          stepId: step.step_id,
        });
      }
      filePaths.set(step.path, step.step_id);
    }
  }
}

function checkMissingInstallBeforeRun(steps: Step[], findings: LintFinding[]): void {
  const hasInstall = steps.some((s) => {
    if (s.type !== 'run_command') return false;
    const cmd = s as RunCommandStep;
    return INSTALL_COMMANDS.some(
      (ic) => cmd.command === ic.command && ic.args.every((a) => cmd.args.includes(a)),
    );
  });

  const hasRunCommand = steps.some((s) => {
    if (s.type !== 'run_command') return false;
    const cmd = s as RunCommandStep;
    return ['node', 'npx', 'python', 'python3', 'pytest', 'jest', 'vitest'].includes(cmd.command);
  });

  const hasPackageJson = steps.some(
    (s) => s.type === 'create_file' && (s as CreateFileStep).path.endsWith('package.json'),
  );

  if (hasPackageJson && hasRunCommand && !hasInstall) {
    findings.push({
      rule: 'missing-install',
      severity: 'warning',
      message: 'Plan creates package.json and runs commands but has no install step (npm install, etc.)',
    });
  }
}

function checkDependencyReferences(steps: Step[], findings: LintFinding[]): void {
  const ids = new Set(steps.map((s) => s.step_id));
  for (const step of steps) {
    for (const dep of step.depends_on ?? []) {
      if (!ids.has(dep)) {
        findings.push({
          rule: 'invalid-dependency',
          severity: 'error',
          message: `Step "${step.step_id}" depends on unknown step "${dep}"`,
          stepId: step.step_id,
        });
      }
    }
  }
}

function checkUnsafeCommand(step: RunCommandStep, findings: LintFinding[]): void {
  if (UNSAFE_COMMANDS.has(step.command)) {
    findings.push({
      rule: 'unsafe-command',
      severity: 'warning',
      message: `Command "${step.command}" is potentially dangerous`,
      stepId: step.step_id,
    });
  }

  for (const arg of step.args) {
    if (UNSAFE_ARG_PATTERNS.some((p) => p.test(arg))) {
      findings.push({
        rule: 'unsafe-args',
        severity: 'warning',
        message: `Argument "${arg}" in step "${step.step_id}" is potentially dangerous`,
        stepId: step.step_id,
      });
    }
  }
}

function checkEmptyCommand(step: RunCommandStep, findings: LintFinding[]): void {
  if (!step.command.trim()) {
    findings.push({
      rule: 'empty-command',
      severity: 'error',
      message: `Step "${step.step_id}" has an empty command`,
      stepId: step.step_id,
    });
  }
}

function checkSuspiciousShell(step: RunCommandStep, findings: LintFinding[]): void {
  if (['sh', 'bash', 'zsh'].includes(step.command) && step.args.includes('-c')) {
    const cmdArg = step.args[step.args.indexOf('-c') + 1];
    if (cmdArg && (cmdArg.includes('|') || cmdArg.includes(';') || cmdArg.includes('&&'))) {
      findings.push({
        rule: 'shell-pipe',
        severity: 'info',
        message: `Step "${step.step_id}" uses shell piping/chaining — consider splitting into separate steps for better determinism`,
        stepId: step.step_id,
      });
    }
  }
}

function checkLargeFileContent(step: CreateFileStep, findings: LintFinding[]): void {
  if (step.content.length > 100_000) {
    findings.push({
      rule: 'large-file',
      severity: 'warning',
      message: `Step "${step.step_id}" creates a file with ${step.content.length} characters — consider external data source`,
      stepId: step.step_id,
    });
  }
}

function checkAbsolutePath(step: CreateFileStep, findings: LintFinding[]): void {
  if (step.path.startsWith('/')) {
    findings.push({
      rule: 'absolute-path',
      severity: 'warning',
      message: `Step "${step.step_id}" uses absolute path "${step.path}" — use relative paths for portability`,
      stepId: step.step_id,
    });
  }
}

function checkParentDirCreation(step: CreateFileStep, allSteps: Step[], findings: LintFinding[]): void {
  const dir = dirname(step.path);
  if (dir === '.' || dir === '') return;

  // Check if any earlier step creates a directory or file in that dir
  const stepIdx = allSteps.indexOf(step);
  const hasMkdir = allSteps.slice(0, stepIdx).some((s) => {
    if (s.type !== 'run_command') return false;
    const cmd = s as RunCommandStep;
    return cmd.command === 'mkdir' && cmd.args.some((a) => step.path.startsWith(a));
  });

  const hasParentFile = allSteps.slice(0, stepIdx).some((s) => {
    if (s.type !== 'create_file') return false;
    return dirname((s as CreateFileStep).path) === dir;
  });

  // Only warn if deeply nested and no parent creation found
  if (dir.includes('/') && !hasMkdir && !hasParentFile) {
    findings.push({
      rule: 'nested-path-no-mkdir',
      severity: 'info',
      message: `Step "${step.step_id}" creates file in "${dir}" — ensure parent directory exists`,
      stepId: step.step_id,
    });
  }
}

function checkEmptyDescription(step: Step, findings: LintFinding[]): void {
  if (!step.description || !step.description.trim()) {
    findings.push({
      rule: 'empty-description',
      severity: 'info',
      message: `Step "${step.step_id}" has no description`,
      stepId: step.step_id,
    });
  }
}

/**
 * Format lint results as a human-readable string.
 */
export function formatLintResult(result: LintResult): string {
  const lines: string[] = [];

  if (result.findings.length === 0) {
    lines.push('No issues found.');
    return lines.join('\n');
  }

  for (const f of result.findings) {
    const prefix = f.severity === 'error' ? 'ERR' : f.severity === 'warning' ? 'WRN' : 'INF';
    const step = f.stepId ? ` [${f.stepId}]` : '';
    lines.push(`  ${prefix}  ${f.rule}${step}: ${f.message}`);
  }

  lines.push('');
  lines.push(`${result.errors} errors, ${result.warnings} warnings, ${result.infos} infos`);

  return lines.join('\n');
}
