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

const program = new Command();

program
  .name('continuum')
  .description(
    'Deterministic runtime for AI-generated execution plans. Run once, cache the plan, replay forever. v3.6: Lint, structured log, compare, annotations, search.',
  )
  .version('3.6.0');

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

program.parse();
