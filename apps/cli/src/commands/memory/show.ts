import { bold, colorStatus, dim } from './colors.js';
import type { MemoryContext } from './context.js';
import { checkedAt, findMemory, lastCheckedCommits } from './shared.js';

const LABEL_WIDTH = 18;

function field(label: string, value: string): string {
  return `  ${`${label}:`.padEnd(LABEL_WIDTH)}${value}`;
}

/** A field whose value may span lines; continuation lines are indented under the value. */
function block(label: string, lines: string[]): string[] {
  if (lines.length === 0) return [field(label, dim('(none)'))];
  const pad = ' '.repeat(LABEL_WIDTH + 2);
  return [field(label, lines[0]!), ...lines.slice(1).map((l) => pad + l)];
}

export async function showCommand(ctx: MemoryContext, args: string[]): Promise<string> {
  const id = args[0];
  if (!id) return 'Usage: soa memory show <id>';
  const found = await findMemory(ctx, id);
  if ('error' in found) return found.error;
  const m = found.memory;
  const n = m.note;
  const commits = await lastCheckedCommits(ctx);
  const text = (s: string) => (s.trim() === '' ? [] : s.split(/\r?\n/));

  return [
    bold(`Memory ${m.memory_id}`),
    field('Repo', m.repo),
    field('Source task', m.source_task_id),
    '',
    ...block('Task', text(n.task)),
    ...block('Problem', text(n.problem)),
    ...block('Cause', text(n.cause)),
    ...block('Files', n.files),
    ...block('Fix', text(n.fix)),
    ...block('Fix snippet', text(n.fix_snippet)),
    ...block('Evidence', text(n.evidence)),
    ...block('Evidence tests', n.evidence_tests),
    ...block('Keywords', n.keywords.length ? [n.keywords.join(', ')] : []),
    ...block('Tags', n.tags.length ? [n.tags.join(', ')] : []),
    ...block('Links', m.links),
    '',
    bold('Verification'),
    field('Status', colorStatus(m.verification.status)),
    ...block('Details', text(m.verification.details)),
    field('Checked at', `${checkedAt(m, commits)} ${dim(`(${m.verification.checked_at})`)}`),
    field('Verified commit', m.verified_at_commit),
    '',
    field('Score', dim('— next phase')),
    field('Action', dim('— next phase')),
    field('Lifecycle', m.lifecycle),
    field('Use count', String(m.use_count)),
  ].join('\n');
}
