import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '@soa/store';
import { NoteRepository } from './note-repository.js';
import { makeNote, makeScore } from '../test-utils/fixtures.js';

describe('NoteRepository', () => {
  let store: MemoryStore;
  let repo: NoteRepository;

  beforeEach(() => {
    store = new MemoryStore();
    repo = new NoteRepository(store);
  });

  it('saves a note and gets it back unchanged', async () => {
    const note = makeNote();
    await repo.save(note);

    expect(await store.exists(`memory/notes/${note.memory_id}.json`)).toBe(true);
    expect(await repo.get(note.memory_id)).toEqual(note);
  });

  it('returns null for a missing note', async () => {
    expect(await repo.get('mem_DOES_NOT_EXIST')).toBeNull();
  });

  it('rejects an invalid note and writes nothing', async () => {
    const note = makeNote();
    const invalid = { ...note, score: { ...note.score, relevance: 1.5 } };

    await expect(repo.save(invalid)).rejects.toThrow();
    expect(await store.list('memory/notes/')).toEqual([]);
  });

  it('lists notes filtered by repo', async () => {
    const django = makeNote({ repo: 'django/django' });
    const flask = makeNote({ repo: 'pallets/flask' });
    await repo.save(django);
    await repo.save(flask);

    expect(await repo.list()).toHaveLength(2);

    const onlyDjango = await repo.list({ repo: 'django/django' });
    expect(onlyDjango.map((n) => n.memory_id)).toEqual([django.memory_id]);
  });

  it('hides pruned notes unless includePruned is set', async () => {
    const active = makeNote();
    const pruned = makeNote({ lifecycle: 'pruned', action: 'DELETE' });
    await repo.save(active);
    await repo.save(pruned);

    const visible = await repo.list();
    expect(visible.map((n) => n.memory_id)).toEqual([active.memory_id]);

    const all = await repo.list({ includePruned: true });
    expect(all.map((n) => n.memory_id).sort()).toEqual([active.memory_id, pruned.memory_id].sort());
  });

  it('updates a note by merging the patch', async () => {
    const note = makeNote();
    await repo.save(note);

    const newScore = makeScore({ relevance: 0.2 });
    const updated = await repo.update(note.memory_id, { use_count: 3, score: newScore });

    expect(updated.use_count).toBe(3);
    expect(updated.score).toEqual(newScore);
    expect(updated.note).toEqual(note.note);
    expect(await repo.get(note.memory_id)).toEqual(updated);
  });

  it('re-validates on update and keeps the stored note unchanged', async () => {
    const note = makeNote();
    await repo.save(note);

    await expect(
      repo.update(note.memory_id, { score: { ...note.score, total: 1.5 } }),
    ).rejects.toThrow();
    expect(await repo.get(note.memory_id)).toEqual(note);
  });

  it('throws a clear error when updating a missing note', async () => {
    await expect(repo.update('mem_MISSING', { use_count: 1 })).rejects.toThrow(
      'Cannot update memory note "mem_MISSING": note not found',
    );
  });
});
