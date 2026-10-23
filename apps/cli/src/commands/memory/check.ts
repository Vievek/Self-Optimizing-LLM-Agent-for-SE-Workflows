import { REFINED_MEMORY_SCHEMA_VERSION, RefinedMemorySchema } from '@soa/contracts';
import {
  renderContractCheckPanel,
  type ContractCheckResult,
} from '../../components/contract-check-panel.js';
import type { MemoryContext } from './context.js';

const NOTES_PREFIX = 'memory/notes/';

/** Validates every stored note file (pruned ones too) against RefinedMemorySchema. */
export async function checkCommand(ctx: MemoryContext): Promise<string> {
  const files = (await ctx.store.list(NOTES_PREFIX)).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) {
    return `No memories in ${ctx.storeDir}. Run "soa memory seed" first.`;
  }

  const results: ContractCheckResult[] = [];
  for (const file of files) {
    const name = file.slice(NOTES_PREFIX.length).replace(/\.json$/, '');
    let error: string | undefined;
    try {
      const parsed = RefinedMemorySchema.safeParse(await ctx.store.read(file));
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        error = `${issue.path.join('.') || '(root)'}: ${issue.message}`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    results.push({
      contract: `RefinedMemory ${name}`,
      version: REFINED_MEMORY_SCHEMA_VERSION,
      valid: error === undefined,
      ...(error ? { error } : {}),
    });
  }
  return renderContractCheckPanel(results);
}
