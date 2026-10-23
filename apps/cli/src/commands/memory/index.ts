import { checkCommand } from './check.js';
import { MemoryContext, type MemoryCommandOptions } from './context.js';
import { listCommand } from './list.js';
import { seedCommand } from './seed.js';
import { showCommand } from './show.js';
import { staleEvalCommand } from './stale-eval.js';
import { tuiPrintCommand } from './tui.js';
import { verifyCommand } from './verify.js';

export type { MemoryCommandOptions } from './context.js';

const SUBCOMMANDS: [string, string][] = [
  ['seed', 'Clear store/memory and add sample memories (scenario + stale-set notes)'],
  ['list [--status <s>]', 'Table of memories with verification status'],
  ['show <id>', 'Full card for one memory (an id prefix works)'],
  ['verify <id> <commit>', 'Re-check a memory at a fixture commit, e.g. memtest-v2'],
  ['check', 'Validate every stored memory against RefinedMemorySchema'],
  ['stale-eval', 'Run the stale-memory test set: catch rate, false alarms, accuracy'],
  ['tui [tab]', 'Print one frame of the live dashboard (use soa memory --tui to interact)'],
  ['help', 'Show this list'],
];

export function memoryHelp(unknown?: string): string {
  const width = Math.max(...SUBCOMMANDS.map(([c]) => c.length));
  return [
    ...(unknown ? [`Unknown memory subcommand "${unknown}".`, ''] : []),
    'Usage: soa memory <subcommand> [args]',
    '',
    ...SUBCOMMANDS.map(([c, d]) => `  ${c.padEnd(width)}  ${d}`),
  ].join('\n');
}

/** Entry point for `soa memory <sub> [args]`. Errors come back as a message, never a stack trace. */
export async function runMemoryCommand(
  args: string[],
  options: MemoryCommandOptions = {},
): Promise<string> {
  const [sub = 'help', ...rest] = args;
  const name = sub.toLowerCase();
  if (name === 'help' || name === '--help' || name === '-h') return memoryHelp();
  const known = ['seed', 'list', 'show', 'verify', 'check', 'stale-eval', 'tui'];
  if (!known.includes(name)) return memoryHelp(sub);
  if (name === 'tui') {
    try {
      return await tuiPrintCommand(rest, options);
    } catch (err) {
      return `memory tui failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const ctx = new MemoryContext(options);
  try {
    switch (name) {
      case 'seed':
        return await seedCommand(ctx);
      case 'list':
        return await listCommand(ctx, rest);
      case 'show':
        return await showCommand(ctx, rest);
      case 'verify':
        return await verifyCommand(ctx, rest);
      case 'check':
        return await checkCommand(ctx);
      default:
        return await staleEvalCommand(ctx);
    }
  } catch (err) {
    return `memory ${name} failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    ctx.close();
  }
}
