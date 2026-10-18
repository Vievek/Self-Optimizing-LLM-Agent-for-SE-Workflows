import { describe, it, expect, beforeEach } from 'vitest';
import { parseSummaryNote, WorkingMemory } from './working-memory.js';

const TASK = { taskId: 'django__django-11099', repo: 'django/django', baseCommit: 'fb8b75e7a9b8f2d' };

describe('WorkingMemory', () => {
  let wm: WorkingMemory;

  beforeEach(() => {
    wm = new WorkingMemory(TASK);
  });

  it('runs a start / explore / complete flow into a FocusSummary', () => {
    wm.startFocus('find the validator');
    wm.explore({ action: 'grep UsernameValidator', observation: 'found in validators.py' });
    wm.explore({
      action: 'read validators.py',
      observation: 'regex uses $',
      files: ['django/contrib/auth/validators.py'],
    });
    const summary = wm.completeFocus({ learned: 'regex anchor is $', outcome: 'success' });

    expect(summary).toEqual({
      topic: 'find the validator',
      tried: ['grep UsernameValidator', 'read validators.py'],
      learned: 'regex anchor is $',
      outcome: 'success',
      files: ['django/contrib/auth/validators.py'],
      tests: [],
    });
    expect(wm.getKnowledge()).toEqual([summary]);
  });

  it('throws when exploring without an open focus', () => {
    expect(() => wm.explore({ action: 'ls', observation: '' })).toThrow(/no focus block is open/);
  });

  it('throws when starting a second focus while one is open', () => {
    wm.startFocus('first');
    expect(() => wm.startFocus('second')).toThrow(/"first" is still open/);
  });

  it('drops raw steps after completeFocus but keeps the knowledge', () => {
    wm.startFocus('topic');
    wm.explore({ action: 'a', observation: 'o' });
    wm.explore({ action: 'b', observation: 'o' });
    wm.explore({ action: 'c', observation: 'o' });
    expect(wm.getContextSize()).toBe(3);

    wm.completeFocus({ learned: 'x', outcome: 'partial' });
    expect(wm.getContextSize()).toBe(1);
    expect(wm.getKnowledge()).toHaveLength(1);

    wm.startFocus('next');
    wm.explore({ action: 'd', observation: 'o' });
    expect(wm.getContextSize()).toBe(2);
  });

  it('merges files as a unique union and keeps the last status per test', () => {
    wm.startFocus('fix');
    wm.explore({
      action: 'edit',
      observation: '',
      files: ['a.py', 'b.py'],
      tests: [
        { id: 't1', passed: false },
        { id: 't2', passed: true },
      ],
    });
    wm.explore({
      action: 'rerun',
      observation: '',
      files: ['b.py', 'c.py'],
      tests: [{ id: 't1', passed: true }],
    });
    wm.explore({ action: 'rerun t2', observation: '', tests: [{ id: 't2', passed: false }] });
    const summary = wm.completeFocus({ learned: 'l', outcome: 'success' });

    expect(summary.files).toEqual(['a.py', 'b.py', 'c.py']);
    expect(summary.tests).toEqual([
      { id: 't1', passed: true },
      { id: 't2', passed: false },
    ]);
  });

  describe('finish', () => {
    function runTwoFocuses(): void {
      wm.startFocus('find the validator');
      wm.explore({
        action: 'grep UsernameValidator',
        observation: '',
        files: ['django/contrib/auth/validators.py'],
      });
      wm.explore({ action: 'read validators.py', observation: '' });
      wm.completeFocus({ learned: 'regex uses $ which allows a trailing newline', outcome: 'success' });

      wm.startFocus('fix the anchor');
      wm.explore({
        action: 'replace $ with \\Z',
        observation: '',
        files: ['django/contrib/auth/validators.py'],
        tests: [
          { id: 'tests/auth_tests/test_validators.py::test_ascii', passed: true },
          { id: 'tests/auth_tests/test_validators.py::test_unicode', passed: false },
        ],
      });
      wm.completeFocus({ learned: 'use \\Z as end anchor', outcome: 'partial' });
    }

    it('produces the exact note format', () => {
      runTwoFocuses();
      const result = wm.finish({ resolved: true });

      expect(result).toEqual({ ...TASK, resolved: true, notes: expect.any(Array) });
      expect(result.notes).toEqual([
        [
          'TOPIC: find the validator',
          'TRIED: grep UsernameValidator; read validators.py',
          'LEARNED: regex uses $ which allows a trailing newline',
          'OUTCOME: success',
          'FILES: django/contrib/auth/validators.py',
          'TESTS: ',
        ].join('\n'),
        [
          'TOPIC: fix the anchor',
          'TRIED: replace $ with \\Z',
          'LEARNED: use \\Z as end anchor',
          'OUTCOME: partial',
          'FILES: django/contrib/auth/validators.py',
          'TESTS: tests/auth_tests/test_validators.py::test_ascii=pass, tests/auth_tests/test_validators.py::test_unicode=fail',
        ].join('\n'),
      ]);
    });

    it('round-trips through parseSummaryNote', () => {
      runTwoFocuses();
      const { notes } = wm.finish({ resolved: false });
      expect(notes.map(parseSummaryNote)).toEqual(wm.getKnowledge());
    });

    it('throws when a focus block is still open', () => {
      wm.startFocus('unfinished');
      expect(() => wm.finish({ resolved: false })).toThrow(/"unfinished" is still open/);
    });
  });
});

describe('parseSummaryNote', () => {
  it('tolerates missing lines', () => {
    expect(parseSummaryNote('TOPIC: only a topic\nFILES: a.py')).toEqual({
      topic: 'only a topic',
      tried: [],
      learned: '',
      outcome: null,
      files: ['a.py'],
      tests: [],
    });
    expect(parseSummaryNote('')).toEqual({
      topic: '',
      tried: [],
      learned: '',
      outcome: null,
      files: [],
      tests: [],
    });
  });
});
