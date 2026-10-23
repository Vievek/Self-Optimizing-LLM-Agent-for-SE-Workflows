import { DECISION_LOG, type VerificationOutcome } from '@soa/memory-agent';
import type { MemoryNote } from '@soa/contracts';
import { bold, colorStatus, dim, green, red } from './colors.js';
import { knownCommits, type MemoryContext } from './context.js';
import { findMemory } from './shared.js';

type Mark = 'pass' | 'fail' | 'skip';

function mark(m: Mark): string {
  if (m === 'pass') return green('✔');
  if (m === 'fail') return red('✖');
  return dim('–');
}

const ITEM_WIDTH = 26;

function item(m: Mark, text: string, note?: string): string {
  return `  ${mark(m)} ${note ? `${text.padEnd(ITEM_WIDTH)}${dim(note)}` : text}`;
}

/** The three checks the verifier makes, in order: file, fix line, evidence tests. */
export function renderChecklist(note: MemoryNote, outcome: VerificationOutcome): string[] {
  const checks = outcome.fileChecks;
  const present = checks.filter((c) => c.result !== 'file_missing').map((c) => c.file);
  const found = checks.find((c) => c.result === 'found');
  const lines: string[] = [];

  if (checks.length === 0) {
    const why = note.files.length === 0 ? 'no files listed' : 'no fix snippet to look for';
    lines.push(item('skip', 'File exists', why));
    lines.push(item('skip', 'Fix line found', why));
  } else {
    lines.push(
      present.length > 0
        ? item('pass', 'File exists', present.join(', '))
        : item('fail', 'File exists', `${checks.map((c) => c.file).join(', ')} missing`),
    );
    lines.push(
      found
        ? item('pass', 'Fix line found', found.file)
        : item('fail', 'Fix line found', present.length ? `not in ${present.join(', ')}` : ''),
    );
  }

  const total = note.evidence_tests.length;
  const t = outcome.testResult;
  if (t) {
    const ok = t.failed === 0 && t.errors === 0 && t.passed === total;
    const extra = [t.failed && `${t.failed} failed`, t.errors && `${t.errors} errors`]
      .filter(Boolean)
      .join(', ');
    lines.push(item(ok ? 'pass' : 'fail', `${t.passed}/${total} evidence tests pass`, extra));
  } else {
    const why =
      total === 0 ? 'no evidence tests listed' : found ? 'not run' : 'not run: fix not found';
    lines.push(item('skip', `0/${total} evidence tests run`, why));
  }
  return lines;
}

export async function verifyCommand(ctx: MemoryContext, args: string[]): Promise<string> {
  const [id, commit] = args;
  if (!id || !commit) return 'Usage: soa memory verify <id> <commit>   e.g. memtest-v2';
  const commits = knownCommits();
  if (!commits.includes(commit)) {
    return `Unknown commit "${commit}". Available: ${commits.join(', ')}.`;
  }
  const found = await findMemory(ctx, id);
  if ('error' in found) return found.error;

  const agent = ctx.agent();
  const result = await agent.reverify(found.memory.memory_id, commit);
  if (!result) return `No memory with id "${id}".`;
  const { memory, outcome } = result;
  const tokens = agent.usage.tokensIn + agent.usage.tokensOut;

  return [
    bold(`Verify ${memory.memory_id} at ${commit}`),
    dim(`Task: ${memory.note.task}`),
    '',
    ...renderChecklist(memory.note, outcome),
    '',
    `Status:   ${colorStatus(outcome.status, outcome.status.toUpperCase())}`,
    `Details:  ${outcome.details}`,
    `Time:     ${outcome.durationMs} ms · ${tokens} model tokens`,
    ctx.runnerLine(),
    dim(`Saved the result and logged it to ${DECISION_LOG}.`),
  ].join('\n');
}
