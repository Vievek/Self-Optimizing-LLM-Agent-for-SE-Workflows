import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { RefinedMemory } from '@soa/contracts';
import { MockLlmProvider } from '@soa/mocks';
import { MemoryStore } from '@soa/store';
import { DECISION_LOG, MemoryAgent, type MemoryDecision } from './memory-agent.js';
import { loadScenario } from './scenarios/load-scenario.js';
import {
  EVIDENCE_TEST,
  FIXED_REGEX_LINE,
  FIXTURES_ROOT,
  makeFixtureSandbox,
  VALIDATORS_FILE,
} from './test-utils/fixture-repos.js';
import { CodeVerifier } from './verify/verifier.js';

const REPO = 'memtest/auth';
const QUERY = 'username validator accepts trailing newline';

// One scenario walked through all three fixture commits; each test builds on the previous one.
describe('MemoryAgent end to end on the memtest repos', () => {
  const fixture = makeFixtureSandbox({ fakeTests: true });
  const store = new MemoryStore();
  const llm = new MockLlmProvider();
  const agent = new MemoryAgent({
    store,
    llm,
    model: 'test-model',
    verifier: new CodeVerifier({ sandbox: fixture.sandbox }),
  });
  let memory: RefinedMemory;
  afterAll(() => fixture.cleanup());

  llm.registerCanned('Task id: memtest__auth-1', {
    content: JSON.stringify({
      task: 'Reject usernames with a trailing newline',
      problem: "UsernameValidator accepted 'alice\\n'",
      cause: 'The regex ended with $, which matches before a trailing newline',
      files: [VALIDATORS_FILE],
      fix: 'Anchor the regex with \\Z instead of $',
      fix_snippet: FIXED_REGEX_LINE,
      evidence: 'The trailing-newline regression test passes',
      evidence_tests: [EVIDENCE_TEST],
      keywords: ['username', 'validator', 'regex', 'newline'],
      tags: ['auth'],
    }),
    tokensIn: 300,
    tokensOut: 90,
  });

  it('consolidate at memtest-v1 stores a verified note', async () => {
    const summary = await loadScenario(path.join(FIXTURES_ROOT, 'scenarios/username-regex.json'));
    memory = (await agent.consolidateWithResult(summary))!;

    expect(memory.verification).toMatchObject({
      status: 'verified',
      details: `Fix found in ${VALIDATORS_FILE}; 1/1 evidence tests pass.`,
    });
    expect(memory.note).toMatchObject({
      files: [VALIDATORS_FILE],
      fix_snippet: FIXED_REGEX_LINE,
      evidence_tests: [EVIDENCE_TEST],
    });
    expect(await agent.repository.get(memory.memory_id)).toEqual(memory);
  });

  it('retrieve at memtest-v1 returns the note', async () => {
    const result = await agent.retrieve(QUERY, REPO, 'memtest-v1');

    expect(result.map((n) => n.memory_id)).toEqual([memory.memory_id]);
    expect(result[0]).toMatchObject({
      verified_at_commit: 'memtest-v1',
      verification: { status: 'verified' },
      use_count: 1,
    });
  });

  it('retrieve at memtest-v2 returns nothing and the stored note is now stale', async () => {
    expect(await agent.retrieve(QUERY, REPO, 'memtest-v2')).toEqual([]);

    const stored = await agent.repository.get(memory.memory_id);
    expect(stored).toMatchObject({
      verified_at_commit: 'memtest-v1',
      verification: { status: 'stale', details: `Fix no longer present in ${VALIDATORS_FILE}.` },
      use_count: 1,
    });
  });

  it('retrieve at memtest-v3 says the file is gone', async () => {
    expect(await agent.retrieve(QUERY, REPO, 'memtest-v3')).toEqual([]);

    const stored = await agent.repository.get(memory.memory_id);
    expect(stored!.verification).toMatchObject({
      status: 'stale',
      details: `${VALIDATORS_FILE} no longer exists.`,
    });
  });

  it('logs one decision line per check and leaves no workspaces behind', async () => {
    const log = await store.readJsonl<MemoryDecision>(DECISION_LOG);

    expect(log.map(({ phase, commit, status }) => ({ phase, commit, status }))).toEqual([
      { phase: 'consolidate', commit: 'memtest-v1', status: 'verified' },
      { phase: 'retrieve', commit: 'memtest-v1', status: 'verified' },
      { phase: 'retrieve', commit: 'memtest-v2', status: 'stale' },
      { phase: 'retrieve', commit: 'memtest-v3', status: 'stale' },
    ]);
    for (const line of log) {
      expect(line).toMatchObject({ memory_id: memory.memory_id, repo: REPO });
      expect(line.details).not.toBe('');
      expect(line.durationMs).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(Date.parse(line.ts))).toBe(false);
    }
    expect(fs.readdirSync(fixture.workDirRoot)).toEqual([]);
    expect(llm.recordedRequests).toHaveLength(1);
  });
});
