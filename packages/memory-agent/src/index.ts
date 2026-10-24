export const PACKAGE_NAME = '@soa/memory-agent';

export { MemoryAgent, DECISION_LOG } from './memory-agent.js';
export type {
  MemoryAgentUsage,
  MemoryDecision,
  NoteSource,
  ReverifyResult,
} from './memory-agent.js';
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
export { decideStatus } from './verify/decide-status.js';
export type { EvidenceTestResult, StatusDecision } from './verify/decide-status.js';
export { loadScenario, replayScenario, ScenarioSchema } from './scenarios/load-scenario.js';
export type { Scenario } from './scenarios/load-scenario.js';
export { withMemoryId, PLACEHOLDER_MEMORY_ID } from './scenarios/evidence.js';
export {
  evaluateStaleSet,
  formatStaleSetReport,
  loadStaleSet,
  summarizeStaleSet,
  StaleCaseSchema,
  StaleSetSchema,
} from './eval/stale-set.js';
export type {
  StaleCase,
  StaleCaseResult,
  StaleSetReport,
  StaleSetSummary,
} from './eval/stale-set.js';
export {
  EVIDENCE_TEST,
  FIXED_REGEX_LINE,
  FIXTURE_REPOS,
  FIXTURES_ROOT,
  STALE_SET_FILE,
  VALIDATORS_FILE,
  fakeValidatorTestRunner,
  isPytestAvailable,
  makeFixtureSandbox,
} from './dev/fixture-sandbox.js';
export type { FixtureSandbox, FixtureSandboxSetup } from './dev/fixture-sandbox.js';
