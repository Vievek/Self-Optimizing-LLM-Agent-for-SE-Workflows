import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CodeVerifier,
  FIXTURE_REPOS,
  isPytestAvailable,
  makeFixtureSandbox,
  MemoryAgent,
  NoteRepository,
  type FixtureSandbox,
  type MemoryAgentOptions,
} from '@soa/memory-agent';
import { MockLlmProvider } from '@soa/mocks';
import { FileStore } from '@soa/store';
import { dim } from './colors.js';

/** Repo root, from src/commands/memory or dist/commands/memory. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
export const DEFAULT_STORE_DIR = path.join(REPO_ROOT, 'store');

/** Model name passed to the agent; the CLI only ever uses MockLlmProvider, so no network. */
const CLI_MODEL = 'mock-model';

export type RunnerChoice = 'auto' | 'pytest' | 'fake';

export interface MemoryCommandOptions {
  /** Store root (default: the repo's store/ folder). */
  storeDir?: string;
  /** auto = real pytest if `python3 -m pytest --version` works, else the fake runner. */
  runner?: RunnerChoice;
}

/** Shared state for one `soa memory` invocation. Call close() when done. */
export class MemoryContext {
  readonly storeDir: string;
  readonly store: FileStore;
  readonly repository: NoteRepository;
  private readonly runnerChoice: RunnerChoice;
  private fixture?: FixtureSandbox;
  private usedPytest = false;

  constructor(options: MemoryCommandOptions = {}) {
    this.storeDir = path.resolve(options.storeDir ?? DEFAULT_STORE_DIR);
    this.store = new FileStore(this.storeDir);
    this.repository = new NoteRepository(this.store);
    this.runnerChoice = options.runner ?? 'auto';
  }

  /** A verifier over the fixture repos; the sandbox is created on first use. */
  verifier(): CodeVerifier {
    if (!this.fixture) {
      this.usedPytest =
        this.runnerChoice === 'pytest' || (this.runnerChoice === 'auto' && isPytestAvailable());
      const workDirRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soa-memory-cli-'));
      this.fixture = makeFixtureSandbox({ fakeTests: !this.usedPytest, workDirRoot });
    }
    return new CodeVerifier({ sandbox: this.fixture.sandbox });
  }

  agent(llm: MemoryAgentOptions['llm'] = new MockLlmProvider()): MemoryAgent {
    return new MemoryAgent({ store: this.store, llm, model: CLI_MODEL, verifier: this.verifier() });
  }

  /** One dim line naming the test runner. Call after verifier(). */
  runnerLine(): string {
    return dim(
      this.usedPytest
        ? 'Test runner: real pytest (python3 -m pytest)'
        : 'Test runner: fake runner (pytest not available; simulates pytest on the fixture repos)',
    );
  }

  close(): void {
    this.fixture?.cleanup();
  }
}

/** Fixture commits the verifier can check out, e.g. memtest-v1. */
export function knownCommits(): string[] {
  return fs
    .readdirSync(FIXTURE_REPOS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}
