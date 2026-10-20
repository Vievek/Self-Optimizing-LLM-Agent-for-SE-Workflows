import { describe, expect, it } from 'vitest';
import { decideStatus } from './decide-status.js';
import type { FileCheck } from './snippet-check.js';

const FILE = 'auth/validators.py';
const TEST = 'tests/test_validators.py::test_rejects_trailing_newline';

const note = {
  files: [FILE],
  fix_snippet: "regex = r'^[\\w.@+-]+\\Z'",
  evidence_tests: [TEST],
};
const found: FileCheck[] = [{ file: FILE, result: 'found' }];
const pass = { passed: 1, failed: 0, errors: 0 };

describe('decideStatus', () => {
  it('no files, no snippet, no tests -> not_applicable', () => {
    expect(decideStatus([], undefined, { files: [], fix_snippet: '', evidence_tests: [] })).toEqual(
      { status: 'not_applicable', details: 'Nothing in the codebase to check.' },
    );
  });

  it('no snippet -> unverifiable', () => {
    expect(decideStatus([], undefined, { ...note, fix_snippet: '  ' })).toEqual({
      status: 'unverifiable',
      details: 'No fix text to locate.',
    });
  });

  it('every listed file missing -> stale', () => {
    const checks: FileCheck[] = [
      { file: FILE, result: 'file_missing' },
      { file: 'auth/forms.py', result: 'file_missing' },
    ];
    expect(decideStatus(checks, undefined, { ...note, files: [FILE, 'auth/forms.py'] })).toEqual({
      status: 'stale',
      details: `${FILE}, auth/forms.py no longer exist.`,
    });
  });

  it('snippet in no listed file -> stale', () => {
    expect(decideStatus([{ file: FILE, result: 'not_found' }], undefined, note)).toEqual({
      status: 'stale',
      details: `Fix no longer present in ${FILE}.`,
    });
  });

  it.each([
    ['fails', { passed: 0, failed: 1, errors: 0 }, [TEST]],
    ['errors', { passed: 0, failed: 0, errors: 1 }, [TEST]],
    ['ran nothing', { passed: 0, failed: 0, errors: 0 }, [TEST]],
    ['ran fewer than listed', { passed: 1, failed: 0, errors: 0 }, [TEST, `${TEST}_2`]],
  ])('snippet found, evidence test %s -> stale', (_label, result, evidence_tests) => {
    expect(decideStatus(found, result, { ...note, evidence_tests })).toEqual({
      status: 'stale',
      details: `Fix present in ${FILE}, but an evidence test fails or no longer exists.`,
    });
  });

  it('snippet found, no evidence tests -> unverifiable', () => {
    expect(decideStatus(found, undefined, { ...note, evidence_tests: [] })).toEqual({
      status: 'unverifiable',
      details: `Fix present in ${FILE}, but no test to confirm it.`,
    });
  });

  it('snippet found, all evidence tests pass -> verified', () => {
    expect(decideStatus(found, pass, note)).toEqual({
      status: 'verified',
      details: `Fix found in ${FILE}; 1/1 evidence tests pass.`,
    });
  });
});
