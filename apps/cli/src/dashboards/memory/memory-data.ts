/**
 * Data layer for the TUI Memory dashboard: the real Memory Agent on store/ and the fixture
 * sandbox (real pytest when available, otherwise the fake runner).
 *
 * Async methods do the work (verify, retrieve, stale eval). The *Sync readers are for the first
 * paint, so a frame can be drawn before anything async has run; they only read files.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  RefinedMemorySchema,
  type ConsolidatedTaskSummary,
  type MemoryVerificationStatus,
  type RefinedMemory,
} from '@soa/contracts';
import {
  DECISION_LOG,
  evaluateStaleSet,
  loadStaleSet,
  NOTES_DIR,
  ScenarioSchema,
  STALE_SET_FILE,
  WorkingMemory,
  type MemoryDecision,
  type StaleSetReport,
  type VerificationOutcome,
} from '@soa/memory-agent';
import { knownCommits, MemoryContext, type RunnerChoice } from '../../commands/memory/context.js';
import { SCENARIO_FILE, seedMemories } from '../../commands/memory/seed.js';

/** Where the last stale-set evaluation is cached (inside the store, next to the decision log). */
export const STALE_EVAL_CACHE = 'logs/memory-stale-eval.json';

export type TestRunnerName = 'pytest' | 'fake';

export interface MemoryDataOptions {
  /** Store root (default: the repo's store/ folder). */
  storeDir?: string;
  runner?: RunnerChoice;
}

export interface VerifyResult {
  memory: RefinedMemory;
  outcome: VerificationOutcome;
  commit: string;
  tokens: number;
  runner: TestRunnerName;
}

export interface RetrieveCandidate {
  memory: RefinedMemory;
  /** Status before this retrieve re-checked it. */
  before: MemoryVerificationStatus;
  returned: boolean;
}

export interface RetrieveResult {
  query: string;
  repo: string;
  commit: string;
  candidates: RetrieveCandidate[];
  returned: number;
  filtered: number;
  durationMs: number;
  runner: TestRunnerName;
}

export interface StaleEvalResult {
  ranAt: string;
  runner: TestRunnerName;
  report: StaleSetReport;
}

export type FocusStepKind = 'start' | 'explore' | 'complete';

export interface FocusStep {
  kind: FocusStepKind;
  topic: string;
  text: string;
  /** WorkingMemory.getContextSize() right after this step. */
  contextSize: number;
}

export interface ScenarioReplay {
  taskId: string;
  repo: string;
  baseCommit: string;
  steps: FocusStep[];
  summary: ConsolidatedTaskSummary;
}

export class MemoryData {
  readonly ctx: MemoryContext;
  private readonly onExit = () => this.ctx.close();
  private cleanupHooked = false;

  constructor(options: MemoryDataOptions = {}) {
    this.ctx = new MemoryContext(options);
  }

  get storeDir(): string {
    return this.ctx.storeDir;
  }

  /** The test runner in use (decided when the sandbox is first needed). */
  runner(): TestRunnerName {
    this.verifier();
    return this.ctx.testRunner() ?? 'fake';
  }

  /** Fixture commits, e.g. memtest-v1 … memtest-v5. */
  commits(): string[] {
    return knownCommits();
  }

  /** Commits a note can be checked at: the fixture commits for memtest repos, else none. */
  commitsFor(memory: RefinedMemory): string[] {
    return memory.repo.startsWith('memtest/') ? this.commits() : [];
  }

  /** Seeds the store (same as `soa memory seed`) when it has no notes. Returns true if it seeded. */
  async ensureSeeded(): Promise<boolean> {
    if ((await this.loadNotes()).length > 0) return false;
    this.verifier();
    await seedMemories(this.ctx);
    return true;
  }

  /** All notes, oldest first (ids sort by creation time). */
  async loadNotes(): Promise<RefinedMemory[]> {
    const notes = await this.ctx.repository.list({ includePruned: true });
    return notes.sort((a, b) => a.memory_id.localeCompare(b.memory_id));
  }

  /** Re-checks a note at `commit`; the agent saves the result and logs a decision line. */
  async verifyNote(memoryId: string, commit: string): Promise<VerifyResult> {
    const agent = this.ctx.agent();
    this.hookCleanup();
    const result = await agent.reverify(memoryId, commit);
    if (!result) throw new Error(`No memory with id "${memoryId}"`);
    return {
      ...result,
      commit,
      tokens: agent.usage.tokensIn + agent.usage.tokensOut,
      runner: this.runner(),
    };
  }

  /** Runs the agent's retrieve() and reports what happened to every candidate. */
  async retrieve(query: string, repo: string, commit: string): Promise<RetrieveResult> {
    const before = (await this.ctx.repository.list({ repo })).sort((a, b) =>
      a.memory_id.localeCompare(b.memory_id),
    );
    const agent = this.ctx.agent();
    this.hookCleanup();
    const started = Date.now();
    const returnedIds = new Set(
      (await agent.retrieve(query, repo, commit)).map((m) => m.memory_id),
    );
    const durationMs = Date.now() - started;

    const candidates: RetrieveCandidate[] = [];
    for (const old of before) {
      const memory = (await this.ctx.repository.get(old.memory_id)) ?? old;
      candidates.push({
        memory,
        before: old.verification.status,
        returned: returnedIds.has(old.memory_id),
      });
    }
    return {
      query,
      repo,
      commit,
      candidates,
      returned: returnedIds.size,
      filtered: candidates.filter((c) => c.memory.verification.status === 'stale').length,
      durationMs,
      runner: this.runner(),
    };
  }

  /** The last `limit` decision-log lines, newest first. */
  async readDecisionLog(limit = 50): Promise<MemoryDecision[]> {
    const log = await this.ctx.store.readJsonl<MemoryDecision>(DECISION_LOG);
    return log.slice(-limit).reverse();
  }

  /** Runs the labelled stale set through the verifier and caches the report in the store. */
  async runStaleEval(): Promise<StaleEvalResult> {
    const cases = await loadStaleSet(STALE_SET_FILE);
    const report = await evaluateStaleSet(this.verifier(), cases);
    const result: StaleEvalResult = {
      ranAt: new Date().toISOString(),
      runner: this.runner(),
      report,
    };
    await this.ctx.store.write(STALE_EVAL_CACHE, result);
    return result;
  }

  /** Replays the username-regex scenario through WorkingMemory, one recorded step per action. */
  async replayScenario(): Promise<ScenarioReplay> {
    const json: unknown = JSON.parse(await fs.promises.readFile(SCENARIO_FILE, 'utf8'));
    const scenario = ScenarioSchema.parse(json);
    const wm = new WorkingMemory({
      taskId: scenario.taskId,
      repo: scenario.repo,
      baseCommit: scenario.baseCommit,
    });
    const steps: FocusStep[] = [];
    const record = (kind: FocusStepKind, topic: string, text: string) =>
      steps.push({ kind, topic, text, contextSize: wm.getContextSize() });

    for (const block of scenario.focus) {
      wm.startFocus(block.topic);
      record('start', block.topic, `start_focus("${block.topic}")`);
      for (const step of block.steps) {
        wm.explore(step);
        record('explore', block.topic, step.action);
      }
      wm.completeFocus({ learned: block.learned, outcome: block.outcome });
      record('complete', block.topic, `complete_focus: ${block.outcome} · ${block.learned}`);
    }
    return {
      taskId: scenario.taskId,
      repo: scenario.repo,
      baseCommit: scenario.baseCommit,
      steps,
      summary: wm.finish({ resolved: scenario.resolved }),
    };
  }

  // ---------------------------------------------------------------------------
  // Synchronous, read-only snapshots for the first paint
  // ---------------------------------------------------------------------------

  /** Notes currently on disk, oldest first. Unreadable files are skipped. */
  loadNotesSync(): RefinedMemory[] {
    const dir = path.join(this.storeDir, NOTES_DIR);
    if (!fs.existsSync(dir)) return [];
    const notes: RefinedMemory[] = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      try {
        const json: unknown = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        notes.push(RefinedMemorySchema.parse(json));
      } catch {
        // A broken note shows up in `soa memory check`; the dashboard just leaves it out.
      }
    }
    return notes.sort((a, b) => a.memory_id.localeCompare(b.memory_id));
  }

  readDecisionLogSync(limit = 50): MemoryDecision[] {
    const file = path.join(this.storeDir, DECISION_LOG);
    if (!fs.existsSync(file)) return [];
    const lines = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
    const out: MemoryDecision[] = [];
    for (const line of lines.slice(-limit).reverse()) {
      try {
        out.push(JSON.parse(line) as MemoryDecision);
      } catch {
        // Skip a half-written line.
      }
    }
    return out;
  }

  /** The cached stale-set result, if one was run before. */
  readStaleEvalSync(): StaleEvalResult | undefined {
    const file = path.join(this.storeDir, STALE_EVAL_CACHE);
    if (!fs.existsSync(file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as StaleEvalResult;
    } catch {
      return undefined;
    }
  }

  close(): void {
    process.off('exit', this.onExit);
    this.ctx.close();
  }

  private verifier() {
    const verifier = this.ctx.verifier();
    this.hookCleanup();
    return verifier;
  }

  /** The sandbox lives in a temp dir; remove it when the process exits. */
  private hookCleanup(): void {
    if (this.cleanupHooked) return;
    this.cleanupHooked = true;
    process.once('exit', this.onExit);
  }
}
