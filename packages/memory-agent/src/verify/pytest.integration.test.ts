import { execSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import type { MemoryNote } from '@soa/contracts';
import { CodeVerifier } from './verifier.js';
import { makeNote } from '../test-utils/fixtures.js';
import {
  EVIDENCE_TEST,
  FIXED_REGEX_LINE,
  makeFixtureSandbox,
  VALIDATORS_FILE,
} from '../test-utils/fixture-repos.js';

function hasPytest(): boolean {
  try {
    execSync('python3 -m pytest --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const note: MemoryNote = {
  ...makeNote().note,
  files: [VALIDATORS_FILE],
  fix_snippet: FIXED_REGEX_LINE,
  evidence_tests: [EVIDENCE_TEST],
};

// Runs the sandbox's default runner (real pytest), so it is skipped where pytest is not installed.
describe.skipIf(!hasPytest())('real pytest runner on the memtest repos', () => {
  const fixture = makeFixtureSandbox();
  const verifier = new CodeVerifier({ sandbox: fixture.sandbox });
  afterAll(() => fixture.cleanup());

  async function runEvidenceTest(commit: string) {
    const ws = await fixture.sandbox.createWorkspace(commit, commit);
    try {
      return await fixture.sandbox.runTests(ws, [EVIDENCE_TEST]);
    } finally {
      await fixture.sandbox.destroy(ws);
    }
  }

  it('v1: the evidence test passes and the note is verified', async () => {
    expect(await runEvidenceTest('memtest-v1')).toMatchObject({ passed: 1, failed: 0, errors: 0 });
    const out = await verifier.verify(note, 'memtest/auth', 'memtest-v1');
    expect(out.status).toBe('verified');
    expect(out.testResult).toEqual({ passed: 1, failed: 0, errors: 0 });
  }, 60_000);

  it('v2: the rewritten validator still passes the test, but the fix is gone so the note is stale', async () => {
    expect(await runEvidenceTest('memtest-v2')).toMatchObject({ passed: 1, failed: 0, errors: 0 });
    const out = await verifier.verify(note, 'memtest/auth', 'memtest-v2');
    expect(out.status).toBe('stale');
    expect(out.testResult).toBeUndefined();
  }, 60_000);
});
