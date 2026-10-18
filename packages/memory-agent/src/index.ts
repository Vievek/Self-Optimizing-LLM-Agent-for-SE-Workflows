export const PACKAGE_NAME = '@soa/memory-agent';

export { MemoryAgent } from './memory-agent.js';
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
