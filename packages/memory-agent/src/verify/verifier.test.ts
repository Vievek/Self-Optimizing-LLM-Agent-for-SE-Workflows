import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { MemoryNote } from '@soa/contracts';
import { CodeVerifier } from './verifier.js';
import { makeNote } from '../test-utils/fixtures.js';
import {
  EVIDENCE_TEST,
  makeFixtureSandbox,
  VALIDATORS_FILE as FILE,
} from '../test-utils/fixture-repos.js';

const REPO = 'memtest/memtest';

function note(overrides: Partial<MemoryNote> = {}): MemoryNote {
  return {
    ...makeNote().note,
    files: [FILE],
    fix_snippet: "regex = r'^[\\w.@+-]+\\Z'",
    evidence_tests: [EVIDENCE_TEST],
    ...overrides,
  };
}

describe('CodeVerifier', () => {
  const fixture = makeFixtureSandbox({ fakeTests: true });
  const verifier = new CodeVerifier({ sandbox: fixture.sandbox });
  afterAll(() => fixture.cleanup());

  it('verifies the note when the fix is present and the evidence test passes (v1)', async () => {
    const out = await verifier.verify(note(), REPO, 'memtest-v1');
    expect(out.status).toBe('verified');
    expect(out.details).toBe(`Fix found in ${FILE}; 1/1 evidence tests pass.`);
    expect(out.fileChecks).toEqual([{ file: FILE, result: 'found' }]);
    expect(out.testResult).toEqual({ passed: 1, failed: 0, errors: 0 });
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('runs the evidence tests in the workspace it checked the snippet in', async () => {
    const create = vi.spyOn(fixture.sandbox, 'createWorkspace');
    const runTests = vi.spyOn(fixture.sandbox, 'runTests');
    await verifier.verify(note(), REPO, 'memtest-v1');
    const ws = await create.mock.results[0]!.value;
    expect(runTests).toHaveBeenCalledWith(ws, [EVIDENCE_TEST]);
    create.mockRestore();
    runTests.mockRestore();
  });

  it('marks the note stale when the fix is present but the evidence test fails', async () => {
    const runTests = vi
      .spyOn(fixture.sandbox, 'runTests')
      .mockResolvedValue({ passed: 0, failed: 1, errors: 0, details: '1 failed' });
    const out = await verifier.verify(note(), REPO, 'memtest-v1');
    expect(out.status).toBe('stale');
    expect(out.details).toBe(
      `Fix present in ${FILE}, but an evidence test fails or no longer exists.`,
    );
    expect(out.testResult).toEqual({ passed: 0, failed: 1, errors: 0 });
    runTests.mockRestore();
  });

  it('marks the note stale when the evidence test no longer exists', async () => {
    const runTests = vi
      .spyOn(fixture.sandbox, 'runTests')
      .mockResolvedValue({ passed: 0, failed: 0, errors: 1, details: 'not found' });
    const out = await verifier.verify(note(), REPO, 'memtest-v1');
    expect(out.status).toBe('stale');
    runTests.mockRestore();
  });

  it('is unverifiable when the fix is present but there is no evidence test', async () => {
    const runTests = vi.spyOn(fixture.sandbox, 'runTests');
    const out = await verifier.verify(note({ evidence_tests: [] }), REPO, 'memtest-v1');
    expect(out.status).toBe('unverifiable');
    expect(out.details).toBe(`Fix present in ${FILE}, but no test to confirm it.`);
    expect(out.testResult).toBeUndefined();
    expect(runTests).not.toHaveBeenCalled();
    runTests.mockRestore();
  });

  it('matches the fix despite indentation differences in the snippet', async () => {
    const out = await verifier.verify(
      note({ fix_snippet: "  class UsernameValidator:\n\n regex =   r'^[\\w.@+-]+\\Z'" }),
      REPO,
      'memtest-v1',
    );
    expect(out.status).toBe('verified');
  });

  it('marks the note stale when the code changed (v2), without running tests', async () => {
    const runTests = vi.spyOn(fixture.sandbox, 'runTests');
    const out = await verifier.verify(note(), REPO, 'memtest-v2');
    expect(out.status).toBe('stale');
    expect(out.details).toBe(`Fix no longer present in ${FILE}.`);
    expect(out.fileChecks).toEqual([{ file: FILE, result: 'not_found' }]);
    expect(out.testResult).toBeUndefined();
    expect(runTests).not.toHaveBeenCalled();
    runTests.mockRestore();
  });

  it('marks the note stale when the file was removed (v3)', async () => {
    const out = await verifier.verify(note(), REPO, 'memtest-v3');
    expect(out.status).toBe('stale');
    expect(out.details).toBe(`${FILE} no longer exists.`);
    expect(out.fileChecks).toEqual([{ file: FILE, result: 'file_missing' }]);
  });

  it('names removed files alongside files that lost the fix', async () => {
    const out = await verifier.verify(note({ files: [FILE, 'auth/gone.py'] }), REPO, 'memtest-v2');
    expect(out.status).toBe('stale');
    expect(out.details).toBe(`Fix no longer present in ${FILE} (auth/gone.py removed).`);
  });

  it('verifies when the fix is in any one of the listed files', async () => {
    const out = await verifier.verify(
      note({ files: ['auth/__init__.py', FILE] }),
      REPO,
      'memtest-v1',
    );
    expect(out.status).toBe('verified');
    expect(out.details).toBe(`Fix found in ${FILE}; 1/1 evidence tests pass.`);
  });

  it('is unverifiable without a fix snippet, and creates no workspace', async () => {
    const spy = vi.spyOn(fixture.sandbox, 'createWorkspace');
    for (const fix_snippet of ['', '   \n ']) {
      const out = await verifier.verify(note({ fix_snippet }), REPO, 'memtest-v1');
      expect(out.status).toBe('unverifiable');
      expect(out.fileChecks).toEqual([]);
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('is unverifiable when a snippet is given but no files are listed', async () => {
    const out = await verifier.verify(note({ files: [] }), REPO, 'memtest-v1');
    expect(out.status).toBe('unverifiable');
  });

  it('is not_applicable when there are no files, snippet or tests', async () => {
    const out = await verifier.verify(
      note({ files: [], fix_snippet: '', evidence_tests: [] }),
      REPO,
      'memtest-v1',
    );
    expect(out.status).toBe('not_applicable');
    expect(out.details).toBe('Nothing in the codebase to check.');
  });

  it('uses workspaceKey to pick the workspace', async () => {
    const workspaceKey = vi.fn((_repo: string, commit: string) => `memtest-${commit}`);
    const keyed = new CodeVerifier({ sandbox: fixture.sandbox, workspaceKey });
    const out = await keyed.verify(note(), REPO, 'v1');
    expect(workspaceKey).toHaveBeenCalledWith(REPO, 'v1');
    expect(out.status).toBe('verified');
  });

  it('destroys every workspace it creates', async () => {
    await verifier.verify(note(), REPO, 'memtest-v1');
    expect(fs.readdirSync(fixture.workDirRoot)).toEqual([]);
  });

  it('destroys the workspace even when a check throws', async () => {
    const readFile = vi
      .spyOn(fixture.sandbox, 'readFile')
      .mockRejectedValue(new Error('permission denied'));
    const destroy = vi.spyOn(fixture.sandbox, 'destroy');

    await expect(verifier.verify(note(), REPO, 'memtest-v1')).rejects.toThrow('permission denied');
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(fixture.workDirRoot)).toEqual([]);

    readFile.mockRestore();
    destroy.mockRestore();
  });
});
