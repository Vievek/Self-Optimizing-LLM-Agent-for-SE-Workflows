import type { ConsolidatedTaskSummary, MemoryService, RefinedMemory } from '@soa/contracts';
import { loadModelsConfig, type LlmProvider } from '@soa/llm';
import type { SandboxService } from '@soa/sandbox';
import type { Store } from '@soa/store';
import { DEFAULT_RETRIEVE_LIMIT, type MemoryAgentOptions } from './options.js';
import { NoteRepository } from './repository/note-repository.js';

export const SUMMARIES_DIR = 'memory/summaries';

export class MemoryAgent implements MemoryService {
  readonly repository: NoteRepository;
  readonly model: string;
  readonly retrieveLimit: number;
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
    await this.store.write(`${SUMMARIES_DIR}/${summary.taskId}.json`, summary);
    // TODO: build RefinedMemory notes from the summary.
  }
}
