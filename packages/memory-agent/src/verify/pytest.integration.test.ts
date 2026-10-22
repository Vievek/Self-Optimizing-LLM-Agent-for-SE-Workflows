import { afterAll, describe, expect, it } from 'vitest';
import type { MemoryNote } from '@soa/contracts';
import { CodeVerifier } from './verifier.js';
import { makeNote } from '../test-utils/fixtures.js';
import { evaluateStaleSet, loadStaleSet } from '../eval/stale-set.js';
import {
  EVIDENCE_TEST,
  FIXED_REGEX_LINE,
  isPytestAvailable,
  makeFixtureSandbox,
  STALE_SET_FILE,
  VALIDATORS_FILE,
} from '../test-utils/fixture-repos.js';

const note: MemoryNote = {
  ...makeNote().note,
  files: [VALIDATORS_FILE],
  fix_snippet: FIXED_REGEX_LINE,
  evidence_tests: [EVIDENCE_TEST],
};

// Runs the sandbox's default runner (real pytest), so it is skipped where pytest is not installed.
describe.skipIf(!isPytestAvailable())('real pytest runner on the memtest repos', () => {
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

  it('v4: the tightened evidence test really fails, so the note is stale', async () => {
    expect(await runEvidenceTest('memtest-v4')).toMatchObject({ passed: 0, failed: 1 });
    const out = await verifier.verify(note, 'memtest/auth', 'memtest-v4');
    expect(out.status).toBe('stale');
    expect(out.fileChecks).toEqual([{ file: VALIDATORS_FILE, result: 'found' }]);
  }, 60_000);

  it('v5: the evidence test was deleted, pytest runs nothing, and the note is stale', async () => {
    expect(await runEvidenceTest('memtest-v5')).toMatchObject({ passed: 0 });
    const out = await verifier.verify(note, 'memtest/auth', 'memtest-v5');
    expect(out.status).toBe('stale');
    expect(out.fileChecks).toEqual([{ file: VALIDATORS_FILE, result: 'found' }]);
  }, 60_000);

  it('the whole stale set gets its expected statuses under real pytest', async () => {
    const report = await evaluateStaleSet(verifier, await loadStaleSet(STALE_SET_FILE));
    expect(report.cases.filter((r) => !r.correct)).toEqual([]);
    expect(report.summary.catchRate).toBe(1);
    expect(report.summary.falseAlarms).toBe(0);
  }, 120_000);
});
