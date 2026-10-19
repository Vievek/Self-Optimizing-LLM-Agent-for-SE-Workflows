import { describe, it, expect, beforeEach } from 'vitest';
import type { ConsolidatedTaskSummary } from '@soa/contracts';
import { MemoryStore } from '@soa/store';
import { MockLlmProvider } from '@soa/mocks';
import { MemoryAgent } from './memory-agent.js';
import { RefinedMemorySchema } from '@soa/contracts';
import { makeNote, makeScore } from './test-utils/fixtures.js';
import { WorkingMemory } from './working-memory/working-memory.js';

describe('MemoryAgent', () => {
  let store: MemoryStore;
  let llm: MockLlmProvider;
  let agent: MemoryAgent;

  beforeEach(() => {
    store = new MemoryStore();
    llm = new MockLlmProvider();
    agent = new MemoryAgent({ store, llm, model: 'test-model', retrieveLimit: 3 });
  });

  describe('retrieve', () => {
    it('returns only non-pruned notes for the repo, best total first, at most retrieveLimit', async () => {
      const scored = (relevance: number) => makeScore({ relevance, correctness: relevance });
      const n1 = makeNote({ score: scored(0.1) });
      const n2 = makeNote({ score: scored(0.9) });
      const n3 = makeNote({ score: scored(0.5) });
      const n4 = makeNote({ score: scored(0.7) });
      const prunedBest = makeNote({ score: scored(1), lifecycle: 'pruned', action: 'DELETE' });
      const otherRepo = makeNote({ repo: 'pallets/flask', score: scored(1) });
      for (const n of [n1, n2, n3, n4, prunedBest, otherRepo]) {
        await agent.repository.save(n);
      }

      const result = await agent.retrieve('validator regex', 'django/django', 'abc123');

      expect(result.map((n) => n.memory_id)).toEqual([n2.memory_id, n4.memory_id, n3.memory_id]);
      expect(result.every((n) => n.repo === 'django/django')).toBe(true);
      expect(result.every((n) => n.lifecycle !== 'pruned')).toBe(true);
    });

    it('defaults retrieveLimit to 5', async () => {
      const defaultAgent = new MemoryAgent({ store, llm, model: 'test-model' });
      for (let i = 0; i < 7; i++) {
        await defaultAgent.repository.save(makeNote());
      }

      expect(defaultAgent.retrieveLimit).toBe(5);
      expect(await defaultAgent.retrieve('q', 'django/django', 'abc123')).toHaveLength(5);
    });

    it('returns an empty list when the repo has no notes', async () => {
      expect(await agent.retrieve('q', 'unknown/repo', 'abc123')).toEqual([]);
    });

    it('makes no model calls', async () => {
      await agent.repository.save(makeNote());
      await agent.retrieve('q', 'django/django', 'abc123');
      expect(llm.recordedRequests).toHaveLength(0);
    });
  });

  describe('consolidate', () => {
    it('saves the summary under memory/summaries/<taskId>.json', async () => {
      const summary: ConsolidatedTaskSummary = {
        taskId: 'django__django-11099',
        repo: 'django/django',
        baseCommit: 'fb8b75e7a9b8f2d',
        resolved: true,
        notes: ['Regex anchor $ allowed trailing newline; use \\Z'],
      };

      await agent.consolidate(summary);

      expect(await store.read('memory/summaries/django__django-11099.json')).toEqual(summary);
    });
  });

  describe('consolidateWithResult', () => {
    it('stores a linked RefinedMemory built from a WorkingMemory run and tracks usage', async () => {
      const similar = makeNote();
      const unrelated = makeNote({
        note: { ...makeNote().note, keywords: ['template'], tags: ['ui'], files: ['x.html'] },
      });
      await agent.repository.save(similar);
      await agent.repository.save(unrelated);

      const wm = new WorkingMemory({
        taskId: 'django__django-11099',
        repo: 'django/django',
        baseCommit: 'fb8b75e7a9b8f2d',
      });
      wm.startFocus('fix username validator');
      wm.explore({
        action: 'replace $ with \\Z',
        observation: 'tests pass',
        files: ['django/contrib/auth/validators.py'],
        tests: [{ id: 'tests/auth_tests/test_validators.py::test_ascii', passed: true }],
      });
      wm.completeFocus({ learned: 'use \\Z as end anchor', outcome: 'success' });
      const summary = wm.finish({ resolved: true });

      llm.registerCanned('Task id: django__django-11099', {
        content: JSON.stringify({
          task: 'Reject usernames with a trailing newline',
          problem: 'Validator accepted a trailing newline',
          cause: 'Regex used $',
          files: [],
          fix: 'Use \\Z',
          fix_snippet: '',
          evidence: 'Tests pass',
          evidence_tests: [],
          keywords: ['regex', 'validator', 'anchor'],
          tags: ['auth'],
        }),
        tokensIn: 120,
        tokensOut: 40,
      });

      const memory = await agent.consolidateWithResult(summary);

      expect(memory).not.toBeNull();
      expect(RefinedMemorySchema.safeParse(memory).success).toBe(true);
      expect(memory).toMatchObject({
        repo: 'django/django',
        source_task_id: 'django__django-11099',
        verified_at_commit: 'fb8b75e7a9b8f2d',
        links: [similar.memory_id],
        verification: { status: 'unverifiable' },
        action: 'KEEP',
        lifecycle: 'active',
        use_count: 0,
      });
      expect(memory!.score.total).toBeCloseTo(0.5);
      expect(memory!.note.files).toEqual(['django/contrib/auth/validators.py']);
      expect(memory!.note.evidence_tests).toEqual([
        'tests/auth_tests/test_validators.py::test_ascii',
      ]);
      expect(await agent.repository.get(memory!.memory_id)).toEqual(memory);
      expect(await store.read('memory/summaries/django__django-11099.json')).toEqual(summary);
      expect(agent.usage).toEqual({ calls: 1, tokensIn: 120, tokensOut: 40 });
    });

    it('returns null for a summary without notes and makes no model calls', async () => {
      const summary: ConsolidatedTaskSummary = {
        taskId: 'empty-task',
        repo: 'django/django',
        baseCommit: 'abc',
        resolved: false,
        notes: [],
      };

      expect(await agent.consolidateWithResult(summary)).toBeNull();
      expect(llm.recordedRequests).toHaveLength(0);
      expect(await agent.repository.list()).toEqual([]);
      expect(agent.usage).toEqual({ calls: 0, tokensIn: 0, tokensOut: 0 });
    });
  });
});
