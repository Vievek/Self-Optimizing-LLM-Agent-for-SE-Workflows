import type { MemoryNote, MemoryVerificationStatus } from '@soa/contracts';
import type { SandboxService } from '@soa/sandbox';
import { checkSnippet, type FileCheck } from './snippet-check.js';

export interface VerificationOutcome {
  status: MemoryVerificationStatus;
  /** One short sentence for the TUI. */
  details: string;
  fileChecks: FileCheck[];
  /** Wall-clock time of the check, for the cost metric. */
  durationMs: number;
}

export interface CodeVerifierOptions {
  sandbox: SandboxService;
  /** Maps (repo, commit) to the task id passed to createWorkspace. Defaults to the commit. */
  workspaceKey?: (repo: string, commit: string) => string;
}

/** Checks a note against the codebase at a given commit. */
export class CodeVerifier {
  private readonly sandbox: SandboxService;
  private readonly workspaceKey: (repo: string, commit: string) => string;

  constructor(options: CodeVerifierOptions) {
    this.sandbox = options.sandbox;
    this.workspaceKey = options.workspaceKey ?? ((_repo, commit) => commit);
  }

  async verify(note: MemoryNote, repo: string, commit: string): Promise<VerificationOutcome> {
    const start = Date.now();
    const done = (
      status: MemoryVerificationStatus,
      details: string,
      fileChecks: FileCheck[] = [],
    ): VerificationOutcome => ({ status, details, fileChecks, durationMs: Date.now() - start });

    const hasSnippet = note.fix_snippet.trim() !== '';
    if (note.files.length === 0 && !hasSnippet && note.evidence_tests.length === 0) {
      return done('not_applicable', 'Nothing in the codebase to check.');
    }
    if (!hasSnippet) {
      return done('unverifiable', 'No fix snippet to look for in the code.');
    }
    if (note.files.length === 0) {
      return done('unverifiable', 'No files listed to search for the fix.');
    }

    const ws = await this.sandbox.createWorkspace(this.workspaceKey(repo, commit), commit);
    try {
      const checks = await checkSnippet(this.sandbox, ws, note.files, note.fix_snippet);
      return done(...decide(checks), checks);
    } finally {
      await this.sandbox.destroy(ws);
    }
  }
}

function decide(checks: FileCheck[]): [MemoryVerificationStatus, string] {
  const found = checks.find((c) => c.result === 'found');
  if (found) {
    return ['verified', `Fix found in ${found.file}.`];
  }
  const missing = checks.filter((c) => c.result === 'file_missing').map((c) => c.file);
  const present = checks.filter((c) => c.result === 'not_found').map((c) => c.file);
  if (present.length === 0) {
    const verb = missing.length === 1 ? 'no longer exists' : 'no longer exist';
    return ['stale', `${list(missing)} ${verb}.`];
  }
  const gone = missing.length > 0 ? ` (${list(missing)} removed)` : '';
  return ['stale', `Fix no longer present in ${list(present)}${gone}.`];
}

function list(files: string[]): string {
  return files.join(', ');
}
