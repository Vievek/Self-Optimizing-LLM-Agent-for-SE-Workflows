import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryNoteSchema, type ConsolidatedTaskSummary } from '@soa/contracts';
import { MockLlmProvider } from '@soa/mocks';
import { buildNote } from './note-builder.js';
import { WorkingMemory } from '../working-memory/working-memory.js';

const TASK_ID = 'django__django-11099';
const PROMPT_MARKER = `Task id: ${TASK_ID}`;
const RETRY_MARKER = 'previous reply was invalid';

function makeSummary(resolved = true): ConsolidatedTaskSummary {
  const wm = new WorkingMemory({ taskId: TASK_ID, repo: 'django/django', baseCommit: 'fb8b75e' });
  wm.startFocus('find the validator');
  wm.explore({ action: 'grep', observation: '', files: ['django/contrib/auth/validators.py'] });
  wm.completeFocus({ learned: 'regex uses $ which allows a trailing newline', outcome: 'success' });
  wm.startFocus('fix the anchor');
  wm.explore({
    action: 'replace $ with \\Z',
    observation: '',
    files: ['django/contrib/auth/validators.py', 'docs/releases/2.2.txt'],
    tests: [
      { id: 'tests/auth_tests/test_validators.py::test_ascii', passed: true },
      { id: 'tests/auth_tests/test_validators.py::test_unicode', passed: false },
    ],
  });
  wm.completeFocus({ learned: 'use \\Z as end anchor', outcome: 'success' });
  return wm.finish({ resolved });
}

const MODEL_NOTE = {
  task: 'Reject usernames with a trailing newline',
  problem: 'UsernameValidator accepted a trailing newline',
  cause: 'Regex used $ as end anchor',
  files: ['some/other/file.py'],
  fix: 'Use \\Z as end anchor',
  fix_snippet: "regex = r'^[\\w.@+-]+\\Z'",
  evidence: 'Validator tests pass',
  evidence_tests: ['tests/made_up.py::test_x'],
  keywords: ['Regex', 'validator', 'anchor'],
  tags: ['auth'],
};

describe('buildNote', () => {
  let llm: MockLlmProvider;

  beforeEach(() => {
    llm = new MockLlmProvider();
  });

  it('builds a valid note from a valid JSON reply with one call at temperature 0', async () => {
    llm.registerCanned(PROMPT_MARKER, JSON.stringify(MODEL_NOTE));

    const result = await buildNote(makeSummary(), llm, 'small-model');

    expect(result.usedFallback).toBe(false);
    expect(MemoryNoteSchema.safeParse(result.note).success).toBe(true);
    expect(result.note.problem).toBe(MODEL_NOTE.problem);
    expect(result.note.fix_snippet).toBe(MODEL_NOTE.fix_snippet);
    expect(result.note.keywords).toEqual(['regex', 'validator', 'anchor']);
    expect(llm.recordedRequests).toHaveLength(1);
    expect(llm.recordedRequests[0]).toMatchObject({ model: 'small-model', temperature: 0 });
    expect(llm.recordedRequests[0]!.messages.map((m) => m.content).join('\n')).toContain(
      'TOPIC: fix the anchor',
    );
  });

  it('takes files and evidence_tests from the summary lines, not the model', async () => {
    llm.registerCanned(PROMPT_MARKER, JSON.stringify(MODEL_NOTE));

    const { note } = await buildNote(makeSummary(), llm, 'm');

    expect(note.files).toEqual(['django/contrib/auth/validators.py', 'docs/releases/2.2.txt']);
    expect(note.evidence_tests).toEqual(['tests/auth_tests/test_validators.py::test_ascii']);
  });

  it('parses a reply wrapped in ``` fences', async () => {
    llm.registerCanned(PROMPT_MARKER, '```json\n' + JSON.stringify(MODEL_NOTE, null, 2) + '\n```');

    const result = await buildNote(makeSummary(), llm, 'm');

    expect(result.usedFallback).toBe(false);
    expect(result.note.task).toBe(MODEL_NOTE.task);
  });

  it('retries once with the validation error and accepts a corrected reply', async () => {
    llm.registerCanned(RETRY_MARKER, JSON.stringify(MODEL_NOTE));
    llm.registerCanned(PROMPT_MARKER, JSON.stringify({ ...MODEL_NOTE, problem: undefined }));

    const result = await buildNote(makeSummary(), llm, 'm');

    expect(result.usedFallback).toBe(false);
    expect(llm.recordedRequests).toHaveLength(2);
    const retryText = llm.recordedRequests[1]!.messages.map((m) => m.content).join('\n');
    expect(retryText).toContain('problem');
  });

  it('falls back to a rule-based note after two invalid replies', async () => {
    llm.registerCanned(PROMPT_MARKER, 'this is not json');

    const result = await buildNote(makeSummary(), llm, 'm');

    expect(result.usedFallback).toBe(true);
    expect(llm.recordedRequests).toHaveLength(2);
    expect(MemoryNoteSchema.safeParse(result.note).success).toBe(true);
    expect(result.note).toEqual({
      task: TASK_ID,
      problem: 'find the validator',
      cause: 'regex uses $ which allows a trailing newline use \\Z as end anchor',
      files: ['django/contrib/auth/validators.py', 'docs/releases/2.2.txt'],
      fix: 'regex uses $ which allows a trailing newline use \\Z as end anchor',
      fix_snippet: '',
      evidence: 'Passing tests: tests/auth_tests/test_validators.py::test_ascii',
      evidence_tests: ['tests/auth_tests/test_validators.py::test_ascii'],
      keywords: ['find', 'validator', 'fix', 'anchor'],
      tags: ['fallback'],
    });
  });

  it('adds the "unresolved" tag for an unresolved summary', async () => {
    llm.registerCanned(PROMPT_MARKER, JSON.stringify(MODEL_NOTE));
    const modelNote = await buildNote(makeSummary(false), llm, 'm');
    expect(modelNote.note.tags).toEqual(['auth', 'unresolved']);

    llm.clearCanned();
    llm.registerCanned(PROMPT_MARKER, 'nope');
    const fallback = await buildNote(makeSummary(false), llm, 'm');
    expect(fallback.note.tags).toEqual(['fallback', 'unresolved']);
  });

  it('sums token counts over all attempts', async () => {
    llm.registerCanned(RETRY_MARKER, { content: 'still bad', tokensIn: 20, tokensOut: 7 });
    llm.registerCanned(PROMPT_MARKER, { content: 'bad', tokensIn: 10, tokensOut: 5 });

    const result = await buildNote(makeSummary(), llm, 'm');

    expect(result).toMatchObject({ tokensIn: 30, tokensOut: 12, calls: 2 });
  });
});
