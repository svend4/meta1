import { Command } from 'commander';
import chalk from 'chalk';
import {
  enqueueRun,
  dequeueNext,
  cancelQueuedRun,
  reprioritizeRun,
  listQueue,
  getQueueStats,
  purgeQueue,
  formatQueue,
} from '../core/run-queue.js';
import type { RunPriority } from '../core/run-queue.js';

export const queueCommand = new Command('queue')
  .description('Manage the run queue');

queueCommand
  .command('add')
  .description('Enqueue a plan for execution')
  .argument('<plan_source>', 'plan file path or hash')
  .option('-p, --priority <level>', 'priority: critical, high, normal, low', 'normal')
  .option('-l, --label <label>', 'human-readable label')
  .action((planSource: string, opts) => {
    const entry = enqueueRun(planSource, {
      priority: opts.priority as RunPriority,
      label: opts.label,
    });
    console.log(`Enqueued: ${entry.queueId} (${entry.priority})`);
  });

queueCommand
  .command('list')
  .description('List queued runs')
  .option('-s, --status <status>', 'filter by status')
  .action((opts) => {
    const entries = listQueue({ status: opts.status });
    console.log(formatQueue(entries));
  });

queueCommand
  .command('next')
  .description('Dequeue and display next run')
  .action(() => {
    const next = dequeueNext();
    if (!next) {
      console.log('Queue is empty.');
      return;
    }
    console.log(`Next: ${next.queueId}  ${next.planSource}  (${next.priority})`);
  });

queueCommand
  .command('cancel')
  .description('Cancel a queued run')
  .argument('<queue_id>', 'queue entry ID')
  .action((queueId: string) => {
    if (cancelQueuedRun(queueId)) {
      console.log(`Cancelled: ${queueId}`);
    } else {
      console.error(chalk.red(`Not found or not in queued state: ${queueId}`));
      process.exit(1);
    }
  });

queueCommand
  .command('reprioritize')
  .description('Change priority of a queued run')
  .argument('<queue_id>', 'queue entry ID')
  .argument('<priority>', 'new priority: critical, high, normal, low')
  .action((queueId: string, priority: string) => {
    if (reprioritizeRun(queueId, priority as RunPriority)) {
      console.log(`Updated: ${queueId} → ${priority}`);
    } else {
      console.error(chalk.red(`Not found or not in queued state: ${queueId}`));
      process.exit(1);
    }
  });

queueCommand
  .command('stats')
  .description('Show queue statistics')
  .action(() => {
    const stats = getQueueStats();
    console.log(`Queued: ${stats.queued}  Running: ${stats.running}  Completed: ${stats.completed}  Failed: ${stats.failed}  Cancelled: ${stats.cancelled}`);
  });

queueCommand
  .command('purge')
  .description('Purge completed/failed/cancelled entries')
  .option('-k, --keep <n>', 'keep last N terminal entries', '0')
  .action((opts) => {
    const removed = purgeQueue({ keepLast: parseInt(opts.keep, 10) });
    console.log(`Purged ${removed} entries.`);
  });
