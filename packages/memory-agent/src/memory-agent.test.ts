import { afterAll, describe, it, expect, beforeEach, vi } from 'vitest';
import type { ConsolidatedTaskSummary, MemoryVerificationStatus } from '@soa/contracts';
import { MemoryStore } from '@soa/store';
import { MockLlmProvider } from '@soa/mocks';
import { DECISION_LOG, MemoryAgent } from './memory-agent.js';
import { RefinedMemorySchema } from '@soa/contracts';
import { makeNote, makeScore } from './test-utils/fixtures.js';
import { WorkingMemory } from './working-memory/working-memory.js';
import { CodeVerifier } from './verify/verifier.js';
import { makeFixtureSandbox } from './test-utils/fixture-repos.js';

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

    it('increments use_count only on the returned notes', async () => {
      const notes = [0.9, 0.5, 0.3, 0.1].map((r) =>
        makeNote({ score: makeScore({ relevance: r }) }),
      );
      for (const n of notes) await agent.repository.save(n);

      await agent.retrieve('q', 'django/django', 'abc123');

      const counts = await Promise.all(notes.map((n) => agent.repository.get(n.memory_id)));
      expect(counts.map((n) => n!.use_count)).toEqual([1, 1, 1, 0]);
    });

    it('makes no model calls', async () => {
      await agent.repository.save(makeNote());
      await agent.retrieve('q', 'django/django', 'abc123');
      expect(llm.recordedRequests).toHaveLength(0);
    });
  });

  describe('retrieve with a verifier', () => {
    const fixture = makeFixtureSandbox();
    afterAll(() => fixture.cleanup());

    function agentWithStatuses(statuses: Record<string, MemoryVerificationStatus>) {
      const verifier = new CodeVerifier({ sandbox: fixture.sandbox });
      vi.spyOn(verifier, 'verify').mockImplementation(async (note) => ({
        status: statuses[note.task]!,
        details: `${statuses[note.task]} detail`,
        fileChecks: [],
        durationMs: 3,
      }));
      return new MemoryAgent({ store, llm, model: 'test-model', retrieveLimit: 3, verifier });
    }
    const withTask = (task: string, relevance: number) =>
      makeNote({ note: { ...makeNote().note, task }, score: makeScore({ relevance }) });

    it('drops stale notes, returns verified first, then unverifiable and not_applicable', async () => {
      const notes = [
        withTask('na', 0.9),
        withTask('stale', 0.8),
        withTask('unverifiable', 0.7),
        withTask('verified-low', 0.2),
        withTask('verified-high', 0.6),
      ];
      const verifying = agentWithStatuses({
        na: 'not_applicable',
        stale: 'stale',
        unverifiable: 'unverifiable',
        'verified-low': 'verified',
        'verified-high': 'verified',
      });
      for (const n of notes) await verifying.repository.save(n);

      const result = await verifying.retrieve('q', 'django/django', 'c2');

      expect(result.map((n) => n.note.task)).toEqual([
        'verified-high',
        'verified-low',
        'unverifiable',
      ]);
      expect(result.every((n) => n.use_count === 1)).toBe(true);
    });

    it('saves the new verification, moving verified_at_commit only for verified notes', async () => {
      const verified = withTask('verified', 0.5);
      const stale = withTask('stale', 0.5);
      const verifying = agentWithStatuses({ verified: 'verified', stale: 'stale' });
      await verifying.repository.save(verified);
      await verifying.repository.save(stale);

      await verifying.retrieve('q', 'django/django', 'c2');

      const v = await verifying.repository.get(verified.memory_id);
      const s = await verifying.repository.get(stale.memory_id);
      expect(v).toMatchObject({
        verified_at_commit: 'c2',
        verification: { status: 'verified', details: 'verified detail' },
        use_count: 1,
      });
      expect(s).toMatchObject({
        verified_at_commit: stale.verified_at_commit,
        verification: { status: 'stale', details: 'stale detail' },
        use_count: 0,
      });
    });

    it('logs one decision per check', async () => {
      const verifying = agentWithStatuses({ a: 'verified', b: 'stale' });
      const a = withTask('a', 0.5);
      const b = withTask('b', 0.4);
      await verifying.repository.save(a);
      await verifying.repository.save(b);

      await verifying.retrieve('q', 'django/django', 'c2');

      expect(await store.readJsonl(DECISION_LOG)).toEqual([
        expect.objectContaining({
          phase: 'retrieve',
          memory_id: a.memory_id,
          commit: 'c2',
          status: 'verified',
          durationMs: 3,
        }),
        expect.objectContaining({
          phase: 'retrieve',
          memory_id: b.memory_id,
          commit: 'c2',
          status: 'stale',
        }),
      ]);
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
