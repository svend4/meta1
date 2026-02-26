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

const program = new Command();

program
  .name('continuum')
  .description(
    'Deterministic runtime for AI-generated execution plans. Run once, cache the plan, replay forever. v3.0: Assertions, drift detection, repair cascade.',
  )
  .version('3.0.0');

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

program.parse();
