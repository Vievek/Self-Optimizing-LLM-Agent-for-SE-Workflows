import { afterAll, describe, expect, it } from 'vitest';
import {
  EVIDENCE_TEST,
  findTestFunction,
  makeFixtureSandbox,
  SIMULATED_FAILURE,
} from './fixture-sandbox.js';

const OTHER_TEST = 'tests/test_validators.py::test_accepts_plain_username';

describe('findTestFunction', () => {
  const src = [
    'import pytest',
    '',
    'def test_a():',
    '    x = 1',
    '',
    '    assert x',
    '',
    'def test_b():',
    '    pass',
  ].join('\n');

  it('returns the function up to the next top-level line', () => {
    expect(findTestFunction(src, 'test_a')).toBe('def test_a():\n    x = 1\n\n    assert x\n');
    expect(findTestFunction(src, 'test_b')).toBe('def test_b():\n    pass');
  });

  it('returns undefined for a missing function, without prefix matches', () => {
    expect(findTestFunction(src, 'test_c')).toBeUndefined();
    expect(findTestFunction(src, 'test_')).toBeUndefined();
  });
});

describe('fakeValidatorTestRunner (via the fixture sandbox)', () => {
  const fixture = makeFixtureSandbox({ fakeTests: true });
  afterAll(() => fixture.cleanup());

  async function run(commit: string, tests: string[]) {
    const ws = await fixture.sandbox.createWorkspace(commit, commit);
    try {
      const { passed, failed, errors } = await fixture.sandbox.runTests(ws, tests);
      return { passed, failed, errors };
    } finally {
      await fixture.sandbox.destroy(ws);
    }
  }

  it.each([
    ['memtest-v1', { passed: 1, failed: 0, errors: 0 }],
    ['memtest-v2', { passed: 0, failed: 1, errors: 0 }],
    ['memtest-v3', { passed: 0, failed: 0, errors: 1 }],
    ['memtest-v4', { passed: 0, failed: 1, errors: 0 }],
    ['memtest-v5', { passed: 0, failed: 0, errors: 1 }],
  ])('%s: evidence test result', async (commit, expected) => {
    expect(await run(commit, [EVIDENCE_TEST])).toEqual(expected);
  });

  it('counts each test id separately', async () => {
    expect(await run('memtest-v4', [OTHER_TEST, EVIDENCE_TEST])).toEqual({
      passed: 1,
      failed: 1,
      errors: 0,
    });
    expect(await run('memtest-v5', [OTHER_TEST, EVIDENCE_TEST])).toEqual({
      passed: 1,
      failed: 0,
      errors: 1,
    });
  });

  it('treats a missing test file as an error', async () => {
    expect(await run('memtest-v1', ['tests/test_nope.py::test_x'])).toEqual({
      passed: 0,
      failed: 0,
      errors: 1,
    });
  });

  it('the v4 failure marker sits inside the evidence test', async () => {
    const ws = await fixture.sandbox.createWorkspace('memtest-v4', 'memtest-v4');
    try {
      const src = await fixture.sandbox.readFile(ws, 'tests/test_validators.py');
      expect(findTestFunction(src, 'test_rejects_trailing_newline')).toContain(SIMULATED_FAILURE);
      expect(findTestFunction(src, 'test_accepts_plain_username')).not.toContain(SIMULATED_FAILURE);
    } finally {
      await fixture.sandbox.destroy(ws);
    }
  });
});
