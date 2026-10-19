export const PACKAGE_NAME = '@soa/memory-agent';

export { MemoryAgent } from './memory-agent.js';
export type { MemoryAgentUsage } from './memory-agent.js';
export { buildNote, FALLBACK_TAG, UNRESOLVED_TAG } from './notes/note-builder.js';
export type { BuildNoteResult } from './notes/note-builder.js';
export { findLinks, MIN_LINK_SCORE, DEFAULT_MAX_LINKS } from './notes/linker.js';
export type { MemoryAgentOptions } from './options.js';
export { NoteRepository } from './repository/note-repository.js';
export type { NoteListFilter } from './repository/note-repository.js';
export {
  WorkingMemory,
  parseSummaryNote,
  formatSummaryNote,
} from './working-memory/working-memory.js';
export type {
  ExploreStep,
  FocusSummary,
  FocusOutcome,
  ParsedSummaryNote,
  TestStatus,
  WorkingMemoryOptions,
} from './working-memory/working-memory.js';
export { checkSnippet, normalizeCode } from './verify/snippet-check.js';
export type { FileCheck } from './verify/snippet-check.js';
export { CodeVerifier } from './verify/verifier.js';
export type { CodeVerifierOptions, VerificationOutcome } from './verify/verifier.js';
