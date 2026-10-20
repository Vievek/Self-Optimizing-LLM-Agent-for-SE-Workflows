import { afterAll, describe, expect, it } from 'vitest';
import { checkSnippet, normalizeCode } from './snippet-check.js';
import { makeFixtureSandbox } from '../test-utils/fixture-repos.js';

const FIX = "regex = r'^[\\w.@+-]+\\Z'";

describe('normalizeCode', () => {
  it('trims lines, collapses whitespace and drops empty lines', () => {
    expect(normalizeCode('  a   =\t1  \n\n\t  b = 2\r\n   \n')).toBe('a = 1\nb = 2');
  });

  it('matches code that differs only in indentation and spacing', () => {
    const file = 'class V:\n    regex   =  r"x"\n\n    def f(self):\n        return  1\n';
    const snippet = 'regex = r"x"\n  def f(self):\n\treturn 1';
    expect(normalizeCode(file)).toContain(normalizeCode(snippet));
  });

  it('does not match when the code itself differs', () => {
    expect(normalizeCode('regex = r"x$"')).not.toContain(normalizeCode('regex = r"x\\Z"'));
  });
});

describe('checkSnippet', () => {
  const fixture = makeFixtureSandbox();
  afterAll(() => fixture.cleanup());

  async function check(commit: string, files: string[]) {
    const ws = await fixture.sandbox.createWorkspace(commit, commit);
    try {
      return await checkSnippet(fixture.sandbox, ws, files, FIX);
    } finally {
      await fixture.sandbox.destroy(ws);
    }
  }

  it('reports found, not_found and file_missing per file', async () => {
    expect(
      await check('memtest-v1', ['auth/validators.py', 'auth/__init__.py', 'nope.py']),
    ).toEqual([
      { file: 'auth/validators.py', result: 'found' },
      { file: 'auth/__init__.py', result: 'not_found' },
      { file: 'nope.py', result: 'file_missing' },
    ]);
  });

  it('reports file_missing when the file was removed', async () => {
    expect(await check('memtest-v3', ['auth/validators.py'])).toEqual([
      { file: 'auth/validators.py', result: 'file_missing' },
    ]);
  });

  it('rethrows errors that are not a missing file', async () => {
    await expect(checkSnippet(fixture.sandbox, 'ws-unknown', ['a.py'], FIX)).rejects.toThrow(
      /Workspace not found/,
    );
  });
});
