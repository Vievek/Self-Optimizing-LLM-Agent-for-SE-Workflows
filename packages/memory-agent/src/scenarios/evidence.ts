import type { MemoryUseRecord } from '@soa/contracts';

/** memory_id used in fixtures/evidence/*.json until a test knows the real id. */
export const PLACEHOLDER_MEMORY_ID = 'mem_REPLACE';

/** Returns a copy of the evidence with every placeholder memory_id replaced by `memoryId`. */
export function withMemoryId<T extends { memory_uses?: MemoryUseRecord[] }>(
  evidence: T,
  memoryId: string,
): T {
  const copy = structuredClone(evidence);
  copy.memory_uses = copy.memory_uses?.map((use) =>
    use.memory_id === PLACEHOLDER_MEMORY_ID ? { ...use, memory_id: memoryId } : use,
  );
  return copy;
}
