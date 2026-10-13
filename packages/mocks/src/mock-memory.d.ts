import { RefinedMemory } from '@soa/contracts';
export declare class MockMemoryAgent {
  retrieve(_query: string): Promise<RefinedMemory[]>;
  store(_memory: Omit<RefinedMemory, 'schema_version'>): Promise<void>;
}
//# sourceMappingURL=mock-memory.d.ts.map
