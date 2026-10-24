import {
  evaluateStaleSet,
  formatStaleSetReport,
  loadStaleSet,
  STALE_SET_FILE,
} from '@soa/memory-agent';
import { bold, dim } from './colors.js';
import type { MemoryContext } from './context.js';

/** Runs the labelled stale set through the verifier and prints catch rate and accuracy. */
export async function staleEvalCommand(ctx: MemoryContext): Promise<string> {
  const cases = await loadStaleSet(STALE_SET_FILE);
  const report = await evaluateStaleSet(ctx.verifier(), cases);
  return [
    bold(`Stale-memory test set (${cases.length} cases)`),
    '',
    formatStaleSetReport(report),
    '',
    ctx.runnerLine(),
    dim('Verification uses 0 model tokens. Nothing is written to the store.'),
  ].join('\n');
}
