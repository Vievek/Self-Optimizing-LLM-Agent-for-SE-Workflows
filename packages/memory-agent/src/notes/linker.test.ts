import { describe, it, expect } from 'vitest';
import type { MemoryNote } from '@soa/contracts';
import { findLinks } from './linker.js';
import { makeNote } from '../test-utils/fixtures.js';

const REPO = 'django/django';

// makeNote() has keywords [regex, validator], tags [auth], files [django/contrib/auth/validators.py].
function newNote(overrides: Partial<MemoryNote> = {}): MemoryNote {
  return { ...makeNote().note, ...overrides };
}

function noteWith(note: Partial<MemoryNote>, extra: Parameters<typeof makeNote>[0] = {}) {
  return makeNote({ ...extra, note: { ...makeNote().note, ...note } });
}

describe('findLinks', () => {
  it('links an overlapping note', () => {
    const similar = makeNote();
    const unrelated = noteWith({ keywords: ['template'], tags: ['ui'], files: ['x.html'] });

    expect(findLinks(newNote(), REPO, [unrelated, similar])).toEqual([similar.memory_id]);
  });

  it('never links a note from another repo', () => {
    const otherRepo = makeNote({ repo: 'pallets/flask' });
    expect(findLinks(newNote(), REPO, [otherRepo])).toEqual([]);
  });

  it('skips pruned notes', () => {
    const pruned = makeNote({ lifecycle: 'pruned', action: 'DELETE' });
    expect(findLinks(newNote(), REPO, [pruned])).toEqual([]);
  });

  it('returns best matches first and respects max', () => {
    const exact = makeNote();
    // Shares 2 of 4 features each: Jaccard 2/6.
    const half = noteWith({ keywords: ['regex', 'other'], tags: ['auth'], files: ['y.py'] });
    const notes = [half, exact, makeNote(), makeNote()];

    const links = findLinks(newNote(), REPO, notes, 2);
    expect(links).toHaveLength(2);
    expect(links[0]).toBe(exact.memory_id);
    expect(links).not.toContain(half.memory_id);
    expect(findLinks(newNote(), REPO, notes, 0)).toEqual([]);
  });

  it('does not link when similarity is below 0.2', () => {
    // Shares 1 feature: Jaccard 1/8.
    const weak = noteWith({ keywords: ['regex', 'a', 'b'], tags: ['c'], files: ['z.py'] });
    expect(findLinks(newNote(), REPO, [weak])).toEqual([]);
  });
});
