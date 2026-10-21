import type { MemoryNote, MemoryVerificationStatus } from '@soa/contracts';
import type { SandboxService } from '@soa/sandbox';
import { decideStatus, hasFixSnippet, type EvidenceTestResult } from './decide-status.js';
import { checkSnippet, type FileCheck } from './snippet-check.js';

export interface VerificationOutcome {
  status: MemoryVerificationStatus;
  /** One short sentence for the TUI. */
  details: string;
  fileChecks: FileCheck[];
  /** Set only when the evidence tests were run. */
  testResult?: EvidenceTestResult;
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
      fileChecks: FileCheck[] = [],
      testResult?: EvidenceTestResult,
    ): VerificationOutcome => ({
      ...decideStatus(fileChecks, testResult, note),
      fileChecks,
      ...(testResult ? { testResult } : {}),
      durationMs: Date.now() - start,
    });

    // Nothing to look for in the code: decide without creating a workspace.
    if (!hasFixSnippet(note) || note.files.length === 0) {
      return done();
    }

    const ws = await this.sandbox.createWorkspace(this.workspaceKey(repo, commit), commit);
    try {
      const checks = await checkSnippet(this.sandbox, ws, note.files, note.fix_snippet);
      const fixFound = checks.some((c) => c.result === 'found');
      // Tests only matter once the fix is present; a missing fix is stale either way.
      if (!fixFound || note.evidence_tests.length === 0) {
        return done(checks);
      }
      const { passed, failed, errors } = await this.sandbox.runTests(ws, note.evidence_tests);
      return done(checks, { passed, failed, errors });
    } finally {
      await this.sandbox.destroy(ws);
    }
  }
}
