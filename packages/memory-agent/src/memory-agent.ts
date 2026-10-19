import {
  computeTotalScore,
  generateMemoryId,
  REFINED_MEMORY_SCHEMA_VERSION,
  type ConsolidatedTaskSummary,
  type MemoryService,
  type RefinedMemory,
} from '@soa/contracts';
import { loadModelsConfig, type LlmProvider } from '@soa/llm';
import type { SandboxService } from '@soa/sandbox';
import type { Store } from '@soa/store';
import { findLinks } from './notes/linker.js';
import { buildNote } from './notes/note-builder.js';
import { DEFAULT_RETRIEVE_LIMIT, type MemoryAgentOptions } from './options.js';
import { NoteRepository } from './repository/note-repository.js';

export const SUMMARIES_DIR = 'memory/summaries';

export interface MemoryAgentUsage {
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

const PLACEHOLDER_DIMENSION = 0.5;

export class MemoryAgent implements MemoryService {
  readonly repository: NoteRepository;
  readonly model: string;
  readonly retrieveLimit: number;
  /** Model usage of the agent's own calls, for the cost metric. */
  readonly usage: MemoryAgentUsage = { calls: 0, tokensIn: 0, tokensOut: 0 };
  private readonly store: Store;
  private readonly llm: LlmProvider;
  private readonly sandbox?: SandboxService;

  constructor(options: MemoryAgentOptions) {
    this.store = options.store;
    this.llm = options.llm;
    this.sandbox = options.sandbox;
    this.model = options.model ?? loadModelsConfig().small.model;
    this.retrieveLimit = options.retrieveLimit ?? DEFAULT_RETRIEVE_LIMIT;
    this.repository = new NoteRepository(options.store);
  }

  async retrieve(_query: string, repo: string, _commit: string): Promise<RefinedMemory[]> {
    // TODO: verify each note at `commit` and rank by relevance to `query`.
    const notes = await this.repository.list({ repo });
    return notes.sort((a, b) => b.score.total - a.score.total).slice(0, this.retrieveLimit);
  }

  async consolidate(summary: ConsolidatedTaskSummary): Promise<void> {
    await this.consolidateWithResult(summary);
  }

  /** Builds, links and stores a note from the summary. Returns null when there is nothing to store. */
  async consolidateWithResult(summary: ConsolidatedTaskSummary): Promise<RefinedMemory | null> {
    await this.store.write(`${SUMMARIES_DIR}/${summary.taskId}.json`, summary);
    if (summary.notes.length === 0) {
      return null;
    }

    const built = await buildNote(summary, this.llm, this.model);
    this.usage.calls += built.calls;
    this.usage.tokensIn += built.tokensIn;
    this.usage.tokensOut += built.tokensOut;

    // The linker skips other repos and pruned notes itself.
    const existing = await this.repository.list({ includePruned: true });
    const links = findLinks(built.note, summary.repo, existing);

    // TODO: code-grounded verification, real scoring and retention decisions replace
    // the placeholder verification, scores, action and lifecycle below.
    const dims = {
      relevance: PLACEHOLDER_DIMENSION,
      correctness: PLACEHOLDER_DIMENSION,
      evidence: PLACEHOLDER_DIMENSION,
      freshness: PLACEHOLDER_DIMENSION,
      task_contribution: PLACEHOLDER_DIMENSION,
    };
    const memory: RefinedMemory = {
      schema_version: REFINED_MEMORY_SCHEMA_VERSION,
      memory_id: generateMemoryId(),
      repo: summary.repo,
      source_task_id: summary.taskId,
      verified_at_commit: summary.baseCommit,
      note: built.note,
      links,
      verification: {
        status: 'unverifiable',
        checked_at: new Date().toISOString(),
        details: 'Not verified yet: code-grounded verification is added in the next step.',
      },
      score: { ...dims, total: computeTotalScore(dims) },
      action: 'KEEP',
      lifecycle: 'active',
      use_count: 0,
    };

    await this.repository.save(memory);
    return memory;
  }
}
