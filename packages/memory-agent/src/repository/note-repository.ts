import { RefinedMemory, RefinedMemorySchema } from '@soa/contracts';
import type { Store } from '@soa/store';

export const NOTES_DIR = 'memory/notes';

export interface NoteListFilter {
  repo?: string;
  includePruned?: boolean;
}

export class NoteRepository {
  constructor(private readonly store: Store) {}

  private pathFor(memoryId: string): string {
    return `${NOTES_DIR}/${memoryId}.json`;
  }

  // Parse after reading (not via store.read's schema) so zod defaults give the output type.
  private async readNote(path: string): Promise<RefinedMemory> {
    return RefinedMemorySchema.parse(await this.store.read(path));
  }

  async save(note: RefinedMemory): Promise<void> {
    const validated = RefinedMemorySchema.parse(note);
    await this.store.write(this.pathFor(validated.memory_id), validated);
  }

  async get(memoryId: string): Promise<RefinedMemory | null> {
    const path = this.pathFor(memoryId);
    if (!(await this.store.exists(path))) {
      return null;
    }
    return this.readNote(path);
  }

  async list(filter: NoteListFilter = {}): Promise<RefinedMemory[]> {
    const paths = await this.store.list(`${NOTES_DIR}/`);
    const notes: RefinedMemory[] = [];
    for (const path of paths) {
      if (!path.endsWith('.json')) continue;
      const note = await this.readNote(path);
      if (filter.repo !== undefined && note.repo !== filter.repo) continue;
      if (!filter.includePruned && note.lifecycle === 'pruned') continue;
      notes.push(note);
    }
    return notes;
  }

  async update(memoryId: string, patch: Partial<RefinedMemory>): Promise<RefinedMemory> {
    const existing = await this.get(memoryId);
    if (!existing) {
      throw new Error(`Cannot update memory note "${memoryId}": note not found`);
    }
    // memory_id is the storage key, so it cannot be changed by a patch.
    const merged = RefinedMemorySchema.parse({ ...existing, ...patch, memory_id: memoryId });
    await this.save(merged);
    return merged;
  }
}
