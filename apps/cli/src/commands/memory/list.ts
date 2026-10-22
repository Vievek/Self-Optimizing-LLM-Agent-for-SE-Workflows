import { dim } from './colors.js';
import type { MemoryContext } from './context.js';
import {
  checkedAt,
  isStatus,
  lastCheckedCommits,
  renderStatusTable,
  shorten,
  STATUSES,
  statusSummary,
} from './shared.js';

export async function listCommand(ctx: MemoryContext, args: string[]): Promise<string> {
  let status: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--status') {
      status = args[++i];
      if (status === undefined || !isStatus(status)) {
        return `Unknown status "${status ?? ''}". Use one of: ${STATUSES.join(', ')}.`;
      }
    } else {
      return `Unknown option "${args[i]}". Usage: soa memory list [--status <${STATUSES.join('|')}>]`;
    }
  }

  const all = await ctx.repository.list();
  if (all.length === 0) {
    return `No memories in ${ctx.storeDir}. Run "soa memory seed" first.`;
  }
  all.sort((a, b) => a.memory_id.localeCompare(b.memory_id));
  const shown = status ? all.filter((m) => m.verification.status === status) : all;
  const commits = await lastCheckedCommits(ctx);

  const rows = shown.map((m) => [
    m.memory_id,
    shorten(m.note.task, 40),
    m.repo,
    m.verification.status,
    checkedAt(m, commits),
    m.links.length,
  ]);
  const table = renderStatusTable(
    ['ID', 'Task', 'Repo', 'Status', 'Checked at', 'Links'],
    rows,
    3,
    shown.map((m) => m.verification.status),
  );

  const lines = [statusSummary(all)];
  if (status) lines.push(dim(`Showing ${shown.length} with status ${status}.`));
  lines.push(table);
  return lines.join('\n');
}
