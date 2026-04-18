import { Command } from 'commander';
import { readAuditLog, getAuditTrail, formatAuditLog } from '../core/audit-log.js';
import type { AuditAction } from '../core/audit-log.js';

export const auditCommand = new Command('audit')
  .description('View immutable audit log of all mutations')
  .option('-a, --action <action>', 'filter by action type')
  .option('-t, --target <id>', 'filter by target ID')
  .option('--since <date>', 'entries after this ISO date')
  .option('--until <date>', 'entries before this ISO date')
  .option('-n, --limit <n>', 'max entries to show', '50')
  .option('--json', 'output as JSON')
  .action((opts) => {
    const entries = readAuditLog({
      action: opts.action as AuditAction | undefined,
      targetId: opts.target,
      since: opts.since,
      until: opts.until,
      limit: parseInt(opts.limit, 10),
    });

    if (opts.json) {
      console.log(JSON.stringify(entries, null, 2));
    } else if (entries.length === 0) {
      console.log('No audit entries found.');
    } else {
      console.log(formatAuditLog(entries));
      console.log(`\n${entries.length} entries`);
    }
  });

export const auditTrailCommand = new Command('audit-trail')
  .description('View audit trail for a specific run/archive/tag')
  .argument('<target_id>', 'target ID (run ID, archive ID, etc.)')
  .option('--json', 'output as JSON')
  .action((targetId: string, opts: { json?: boolean }) => {
    const entries = getAuditTrail(targetId);

    if (opts.json) {
      console.log(JSON.stringify(entries, null, 2));
    } else if (entries.length === 0) {
      console.log(`No audit trail for ${targetId}`);
    } else {
      console.log(formatAuditLog(entries));
    }
  });
