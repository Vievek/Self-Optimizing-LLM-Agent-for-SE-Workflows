import type { MemoryNote, RefinedMemory } from '@soa/contracts';

export const MIN_LINK_SCORE = 0.2;
export const DEFAULT_MAX_LINKS = 5;

function featureSet(note: MemoryNote): Set<string> {
  return new Set([
    ...note.keywords.map((k) => `kw:${k.toLowerCase()}`),
    ...note.tags.map((t) => `tag:${t.toLowerCase()}`),
    ...note.files.map((f) => `file:${f}`),
  ]);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const x of a) {
    if (b.has(x)) shared++;
  }
  return shared / (a.size + b.size - shared);
}

/**
 * Returns memory_ids of existing notes in the same repo that overlap with `note`
 * (Jaccard over keywords + tags + file paths >= 0.2), best first, at most `max`.
 */
export function findLinks(
  note: MemoryNote,
  repo: string,
  existing: RefinedMemory[],
  max = DEFAULT_MAX_LINKS,
): string[] {
  const features = featureSet(note);
  return existing
    .filter((m) => m.repo === repo && m.lifecycle !== 'pruned')
    .map((m) => ({ id: m.memory_id, score: jaccard(features, featureSet(m.note)) }))
    .filter((s) => s.score >= MIN_LINK_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, max))
    .map((s) => s.id);
}
