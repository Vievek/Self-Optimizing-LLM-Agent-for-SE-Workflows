import type { MemoryNote, MemoryVerificationStatus } from '@soa/contracts';
import type { FileCheck } from './snippet-check.js';

/** Counts from running the note's evidence tests. */
export interface EvidenceTestResult {
  passed: number;
  failed: number;
  errors: number;
}

export interface StatusDecision {
  status: MemoryVerificationStatus;
  /** One short sentence for the TUI. */
  details: string;
}

type NoteFields = Pick<MemoryNote, 'files' | 'fix_snippet' | 'evidence_tests'>;

export function hasFixSnippet(note: Pick<MemoryNote, 'fix_snippet'>): boolean {
  return note.fix_snippet.trim() !== '';
}

/**
 * A test counts as missing when it errored (e.g. import or collection error) or nothing ran.
 * Fewer passes than listed tests also counts, so "N/N pass" always means every listed test passed.
 */
export function testsMissing(result: EvidenceTestResult, expected: number): boolean {
  return (
    result.errors > 0 ||
    result.passed + result.failed === 0 ||
    result.passed + result.failed < expected
  );
}

/** Turns the snippet checks and evidence test result into the note's verification status. */
export function decideStatus(
  checks: FileCheck[],
  testResult: EvidenceTestResult | undefined,
  note: NoteFields,
): StatusDecision {
  const hasSnippet = hasFixSnippet(note);
  if (note.files.length === 0 && !hasSnippet && note.evidence_tests.length === 0) {
    return { status: 'not_applicable', details: 'Nothing in the codebase to check.' };
  }
  if (!hasSnippet) {
    return { status: 'unverifiable', details: 'No fix text to locate.' };
  }
  if (note.files.length === 0) {
    return { status: 'unverifiable', details: 'No files listed to search for the fix.' };
  }

  const found = checks.find((c) => c.result === 'found');
  if (!found) {
    return { status: 'stale', details: describeMissingFix(checks) };
  }

  const total = note.evidence_tests.length;
  if (total === 0) {
    return {
      status: 'unverifiable',
      details: `Fix present in ${found.file}, but no test to confirm it.`,
    };
  }
  if (!testResult || testResult.failed > 0 || testsMissing(testResult, total)) {
    return {
      status: 'stale',
      details: `Fix present in ${found.file}, but an evidence test fails or no longer exists.`,
    };
  }
  return {
    status: 'verified',
    details: `Fix found in ${found.file}; ${testResult.passed}/${total} evidence tests pass.`,
  };
}

function describeMissingFix(checks: FileCheck[]): string {
  const missing = checks.filter((c) => c.result === 'file_missing').map((c) => c.file);
  const present = checks.filter((c) => c.result === 'not_found').map((c) => c.file);
  if (present.length === 0) {
    const verb = missing.length === 1 ? 'no longer exists' : 'no longer exist';
    return `${list(missing)} ${verb}.`;
  }
  const gone = missing.length > 0 ? ` (${list(missing)} removed)` : '';
  return `Fix no longer present in ${list(present)}${gone}.`;
}

function list(files: string[]): string {
  return files.join(', ');
}
