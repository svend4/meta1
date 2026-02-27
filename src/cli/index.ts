#!/usr/bin/env node

import { Command } from 'commander';
import { freezeCommand } from './freeze.js';
import { runCommand } from './run.js';
import { replayCommand } from './replay.js';
import { executeCommand } from './execute.js';
import { inspectCommand } from './inspect.js';
import { explainCommand } from './explain.js';
import { diffCommand } from './diff.js';
import { listCommand } from './list.js';
import { cacheCommand } from './cache.js';
import { historyCommand } from './history.js';
import { forensicsCommand } from './forensics.js';
import { approveDriftCommand } from './approve-drift.js';
import { editCommand } from './edit.js';
import { bundleCommand } from './bundle.js';
import { graphCommand } from './graph.js';
import { validateCommand } from './validate.js';
import { cleanupCommand } from './cleanup.js';
import { planDiffCommand } from './plan-diff.js';
import { doctorCommand } from './doctor.js';
import { initCommand } from './init.js';
import { composeCommand } from './compose.js';
import { statusCommand } from './status.js';
import { lintCommand } from './lint.js';
import { compareCommand } from './compare.js';
import { searchCommand } from './search.js';
import { metricsCommand } from './metrics.js';
import { timelineCommand } from './timeline.js';
import { exportCommand } from './export.js';
import { archiveCommand } from './archive.js';
import { tagCommand } from './tag.js';
import { deepValidateCommand } from './deep-validate.js';
import { auditCommand, auditTrailCommand } from './audit.js';
import { narrativeCommand } from './narrative.js';
import { optimizeCommand } from './optimize.js';
import { snapshotCommand } from './snapshot.js';
import { workspaceDiffCommand } from './workspace-diff.js';
import { queueCommand } from './queue.js';
import { versionCommand } from './version-history.js';
import { templateCommand } from './template-lib.js';
import { estimateCommand } from './estimate.js';
import { envCommand } from './env.js';
import { mergeCommand } from './merge.js';
import { resolveCommand } from './resolve-deps.js';

const program = new Command();

program
  .name('continuum')
  .description(
    'Deterministic runtime for AI-generated execution plans. Run once, cache the plan, replay forever. v4.4: Timeout manager, run snapshots, lint engine, output aggregator, access control.',
  )
  .version('4.4.0');

program.addCommand(runCommand);
program.addCommand(executeCommand);
program.addCommand(replayCommand);
program.addCommand(explainCommand);
program.addCommand(inspectCommand);
program.addCommand(diffCommand);
program.addCommand(listCommand);
program.addCommand(freezeCommand);
program.addCommand(cacheCommand);
// v3.0 commands
program.addCommand(historyCommand);
program.addCommand(forensicsCommand);
program.addCommand(approveDriftCommand);
program.addCommand(editCommand);
program.addCommand(bundleCommand);
program.addCommand(graphCommand);
// v3.1 commands
program.addCommand(validateCommand);
program.addCommand(cleanupCommand);
// v3.2 commands
program.addCommand(planDiffCommand);
// v3.3 commands
program.addCommand(doctorCommand);
// v3.4 commands
program.addCommand(initCommand);
program.addCommand(composeCommand);
// v3.5 commands
program.addCommand(statusCommand);
// v3.6 commands
program.addCommand(lintCommand);
program.addCommand(compareCommand);
program.addCommand(searchCommand);
// v3.7 commands
program.addCommand(metricsCommand);
program.addCommand(timelineCommand);
// v3.8 commands
program.addCommand(exportCommand);
program.addCommand(archiveCommand);
program.addCommand(tagCommand);
// v3.9 commands
program.addCommand(deepValidateCommand);
program.addCommand(auditCommand);
program.addCommand(auditTrailCommand);
program.addCommand(narrativeCommand);
// v4.0 commands
program.addCommand(optimizeCommand);
program.addCommand(snapshotCommand);
program.addCommand(workspaceDiffCommand);
// v4.1 commands
program.addCommand(queueCommand);
program.addCommand(versionCommand);
// v4.2 commands
program.addCommand(templateCommand);
program.addCommand(estimateCommand);
program.addCommand(envCommand);
// v4.3 commands
program.addCommand(mergeCommand);
program.addCommand(resolveCommand);

program.parse();
