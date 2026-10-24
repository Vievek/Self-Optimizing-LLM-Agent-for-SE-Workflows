import type { MemoryVerificationStatus, RefinedMemory } from '@soa/contracts';
import { DECISION_LOG, type MemoryDecision } from '@soa/memory-agent';
import { renderRecordTable } from '../../components/record-table.js';
import { colorStatus, dim } from './colors.js';
import type { MemoryContext } from './context.js';

export const STATUSES: MemoryVerificationStatus[] = [
  'verified',
  'stale',
  'unverifiable',
  'not_applicable',
];

export function isStatus(s: string): s is MemoryVerificationStatus {
  return (STATUSES as string[]).includes(s);
}

export function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

type Cell = string | number;

/**
 * renderRecordTable, with one column coloured by status afterwards. The table is laid out on
 * plain text first so the ANSI codes do not throw off the column widths.
 */
export function renderStatusTable(
  headers: string[],
  rows: Cell[][],
  statusColumn: number,
  statuses: MemoryVerificationStatus[],
  title?: string,
): string {
  const table = renderRecordTable(headers, rows, title);
  if (rows.length === 0) return table;
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)),
  );
  // "| " then each earlier column plus " | ".
  const start = 2 + widths.slice(0, statusColumn).reduce((sum, w) => sum + w + 3, 0);
  const lines = table.split('\n');
  const firstRow = lines.length - 1 - rows.length;
  return lines
    .map((line, i) => {
      const r = i - firstRow;
      if (r < 0 || r >= rows.length) return line;
      const text = String(rows[r]![statusColumn]);
      const end = start + text.length;
      return line.slice(0, start) + colorStatus(statuses[r]!, text) + line.slice(end);
    })
    .join('\n');
}

/** The commit each note was last checked at, from the decision log. */
export async function lastCheckedCommits(ctx: MemoryContext): Promise<Map<string, string>> {
  const log = await ctx.store.readJsonl<MemoryDecision>(DECISION_LOG);
  const commits = new Map<string, string>();
  for (const d of log) commits.set(d.memory_id, d.commit);
  return commits;
}

/** Last checked commit, falling back to the commit the note was last verified at. */
export function checkedAt(memory: RefinedMemory, commits: Map<string, string>): string {
  return commits.get(memory.memory_id) ?? memory.verified_at_commit;
}

export type Lookup = { memory: RefinedMemory } | { error: string };

/** Finds a note by full id or by a unique id prefix. */
export async function findMemory(ctx: MemoryContext, id: string): Promise<Lookup> {
  const exact = await ctx.repository.get(id);
  if (exact) return { memory: exact };
  const matches = (await ctx.repository.list({ includePruned: true })).filter((m) =>
    m.memory_id.startsWith(id),
  );
  if (matches.length === 1) return { memory: matches[0]! };
  if (matches.length > 1) {
    return { error: `"${id}" matches ${matches.length} memories; use more of the id.` };
  }
  return { error: `No memory with id "${id}". Run "soa memory list" to see ids.` };
}

/** "N memories · x verified · y stale · z unverifiable · w not applicable", coloured. */
export function statusSummary(memories: RefinedMemory[]): string {
  const count = (s: MemoryVerificationStatus) =>
    memories.filter((m) => m.verification.status === s).length;
  const parts = STATUSES.map((s) => colorStatus(s, `${count(s)} ${s.replace('_', ' ')}`));
  const noun = memories.length === 1 ? 'memory' : 'memories';
  return [`${memories.length} ${noun}`, ...parts].join(dim(' · '));
}
