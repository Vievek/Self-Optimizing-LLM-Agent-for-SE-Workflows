import {
  computeTotalScore,
  generateMemoryId,
  REFINED_MEMORY_SCHEMA_VERSION,
  type ConsolidatedTaskSummary,
  type MemoryNote,
  type MemoryService,
  type MemoryVerificationStatus,
  type RefinedMemory,
} from '@soa/contracts';
import { loadModelsConfig, type LlmProvider } from '@soa/llm';
import type { SandboxService } from '@soa/sandbox';
import type { Store } from '@soa/store';
import { findLinks } from './notes/linker.js';
import { buildNote } from './notes/note-builder.js';
import { DEFAULT_RETRIEVE_LIMIT, type MemoryAgentOptions } from './options.js';
import { NoteRepository } from './repository/note-repository.js';
import type { CodeVerifier, VerificationOutcome } from './verify/verifier.js';

export const SUMMARIES_DIR = 'memory/summaries';
export const DECISION_LOG = 'logs/memory-decisions.jsonl';

export interface MemoryAgentUsage {
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

/** One line of the decision log, written for every verification check. */
export interface MemoryDecision {
  ts: string;
  /** 'verify' is a manual re-check, e.g. from `soa memory verify`. */
  phase: 'consolidate' | 'retrieve' | 'verify';
  memory_id: string;
  repo: string;
  commit: string;
  status: MemoryVerificationStatus;
  details: string;
  durationMs: number;
}

type Verification = RefinedMemory['verification'];

/** Where a note handed to storeNote() comes from. */
export interface NoteSource {
  repo: string;
  /** Commit the note is verified at. */
  commit: string;
  sourceTaskId: string;
}

export interface ReverifyResult {
  memory: RefinedMemory;
  outcome: VerificationOutcome;
}

const PLACEHOLDER_DIMENSION = 0.5;

// Order of the notes retrieve() returns; stale notes are never returned.
const STATUS_RANK: Record<MemoryVerificationStatus, number> = {
  verified: 0,
  unverifiable: 1,
  not_applicable: 2,
  stale: 3,
};

export class MemoryAgent implements MemoryService {
  readonly repository: NoteRepository;
  readonly model: string;
  readonly retrieveLimit: number;
  /** Model usage of the agent's own calls, for the cost metric. */
  readonly usage: MemoryAgentUsage = { calls: 0, tokensIn: 0, tokensOut: 0 };
  private readonly store: Store;
  private readonly llm: LlmProvider;
  private readonly sandbox?: SandboxService;
  private readonly verifier?: CodeVerifier;

  constructor(options: MemoryAgentOptions) {
    this.store = options.store;
    this.llm = options.llm;
    this.sandbox = options.sandbox;
    this.verifier = options.verifier;
    this.model = options.model ?? loadModelsConfig().small.model;
    this.retrieveLimit = options.retrieveLimit ?? DEFAULT_RETRIEVE_LIMIT;
    this.repository = new NoteRepository(options.store);
  }

  async retrieve(_query: string, repo: string, commit: string): Promise<RefinedMemory[]> {
    // TODO: rank by relevance to `query`.
    const candidates = await this.repository.list({ repo });
    candidates.sort((a, b) => b.score.total - a.score.total);

    let usable = candidates;
    if (this.verifier) {
      usable = [];
      for (const memory of candidates) {
        const { verification } = await this.check(
          'retrieve',
          memory.memory_id,
          memory.note,
          repo,
          commit,
        );
        const updated = await this.repository.update(memory.memory_id, {
          verification,
          ...(verification.status === 'verified' ? { verified_at_commit: commit } : {}),
        });
        if (verification.status !== 'stale') {
          usable.push(updated);
        }
      }
      // Array.prototype.sort is stable, so score order holds within a status.
      usable.sort(
        (a, b) => STATUS_RANK[a.verification.status] - STATUS_RANK[b.verification.status],
      );
    }

    const returned: RefinedMemory[] = [];
    for (const memory of usable.slice(0, this.retrieveLimit)) {
      returned.push(
        await this.repository.update(memory.memory_id, { use_count: memory.use_count + 1 }),
      );
    }
    return returned;
  }

  async consolidate(summary: ConsolidatedTaskSummary): Promise<void> {
    await this.consolidateWithResult(summary);
  }

  /** Builds, links, verifies and stores a note from the summary. Returns null when there is nothing to store. */
  async consolidateWithResult(summary: ConsolidatedTaskSummary): Promise<RefinedMemory | null> {
    await this.store.write(`${SUMMARIES_DIR}/${summary.taskId}.json`, summary);
    if (summary.notes.length === 0) {
      return null;
    }

    const built = await buildNote(summary, this.llm, this.model);
    this.usage.calls += built.calls;
    this.usage.tokensIn += built.tokensIn;
    this.usage.tokensOut += built.tokensOut;

    return this.storeNote(built.note, {
      repo: summary.repo,
      commit: summary.baseCommit,
      sourceTaskId: summary.taskId,
    });
  }

  /** Links, verifies (if a verifier is set) and stores an already-built note. */
  async storeNote(note: MemoryNote, source: NoteSource): Promise<RefinedMemory> {
    // The linker skips other repos and pruned notes itself.
    const existing = await this.repository.list({ includePruned: true });
    const links = findLinks(note, source.repo, existing);

    const memoryId = generateMemoryId();
    const verification: Verification = this.verifier
      ? (await this.check('consolidate', memoryId, note, source.repo, source.commit)).verification
      : {
          status: 'unverifiable',
          checked_at: new Date().toISOString(),
          details: 'Not verified: no code verifier configured.',
        };

    // TODO: real scoring and retention decisions replace the placeholder scores, action and
    // lifecycle below (next PR).
    const dims = {
      relevance: PLACEHOLDER_DIMENSION,
      correctness: PLACEHOLDER_DIMENSION,
      evidence: PLACEHOLDER_DIMENSION,
      freshness: PLACEHOLDER_DIMENSION,
      task_contribution: PLACEHOLDER_DIMENSION,
    };
    const memory: RefinedMemory = {
      schema_version: REFINED_MEMORY_SCHEMA_VERSION,
      memory_id: memoryId,
      repo: source.repo,
      source_task_id: source.sourceTaskId,
      verified_at_commit: source.commit,
      note,
      links,
      verification,
      score: { ...dims, total: computeTotalScore(dims) },
      action: 'KEEP',
      lifecycle: 'active',
      use_count: 0,
    };

    await this.repository.save(memory);
    return memory;
  }

  /**
   * Re-checks a stored note at `commit`, saves the new verification and logs the decision.
   * Returns null when the note does not exist. Throws if no verifier is configured.
   */
  async reverify(memoryId: string, commit: string): Promise<ReverifyResult | null> {
    if (!this.verifier) {
      throw new Error('Cannot reverify: no code verifier configured.');
    }
    const memory = await this.repository.get(memoryId);
    if (!memory) {
      return null;
    }
    const { verification, outcome } = await this.check(
      'verify',
      memoryId,
      memory.note,
      memory.repo,
      commit,
    );
    const updated = await this.repository.update(memoryId, {
      verification,
      ...(verification.status === 'verified' ? { verified_at_commit: commit } : {}),
    });
    return { memory: updated, outcome };
  }

  /** Verifies a note at `commit` and appends the decision to the log. */
  private async check(
    phase: MemoryDecision['phase'],
    memoryId: string,
    note: MemoryNote,
    repo: string,
    commit: string,
  ): Promise<{ verification: Verification; outcome: VerificationOutcome }> {
    const outcome = await this.verifier!.verify(note, repo, commit);
    const ts = new Date().toISOString();
    const decision: MemoryDecision = {
      ts,
      phase,
      memory_id: memoryId,
      repo,
      commit,
      status: outcome.status,
      details: outcome.details,
      durationMs: outcome.durationMs,
    };
    await this.store.append(DECISION_LOG, decision);
    return {
      verification: { status: outcome.status, checked_at: ts, details: outcome.details },
      outcome,
    };
  }
}
