import { RefinedMemory } from '@soa/contracts';

export class MockMemoryAgent {
  async retrieve(_query: string): Promise<RefinedMemory[]> {
    return [];
  }

  async store(_memory: Omit<RefinedMemory, 'schema_version'>): Promise<void> {
    return;
  }
}
