import fs from 'node:fs';
import path from 'node:path';
import type { RefinedMemory } from '@soa/contracts';
import {
  EVIDENCE_TEST,
  FIXED_REGEX_LINE,
  FIXTURES_ROOT,
  loadScenario,
  loadStaleSet,
  STALE_SET_FILE,
  VALIDATORS_FILE,
} from '@soa/memory-agent';
import { MockLlmProvider } from '@soa/mocks';
import { renderStageProgress } from '../../components/stage-progress.js';
import { dim } from './colors.js';
import type { MemoryContext } from './context.js';
import { renderStatusTable, shorten, statusSummary } from './shared.js';

export const SCENARIO_FILE = path.join(FIXTURES_ROOT, 'scenarios/username-regex.json');

/** Stale-set notes added by seed, chosen to give a mix of statuses. */
export const SEED_CASES = [
  'code-rewritten-v2',
  'test-now-fails-v4',
  'test-deleted-v5',
  'no-evidence-tests-v1',
  'nothing-to-check-v1',
];

/** The card the mock model "writes" for the scenario, so seed needs no network or HF_TOKEN. */
function cannedCardLlm(taskId: string): MockLlmProvider {
  const llm = new MockLlmProvider();
  llm.registerCanned(`Task id: ${taskId}`, {
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
    tokensIn: 0,
    tokensOut: 0,
  });
  return llm;
}

export interface SeededMemory {
  memory: RefinedMemory;
  source: string;
}

export interface SeedResult {
  created: SeededMemory[];
  /** Notes in the replayed scenario summary. */
  summaryNotes: number;
  scenarioStored: boolean;
  /** Model tokens the (mock) model used to write the scenario card. */
  tokens: number;
}

/** Clears store/memory and adds the scenario note plus the SEED_CASES stale-set notes. */
export async function seedMemories(ctx: MemoryContext): Promise<SeedResult> {
  fs.rmSync(path.join(ctx.storeDir, 'memory'), { recursive: true, force: true });

  const summary = await loadScenario(SCENARIO_FILE);
  const agent = ctx.agent(cannedCardLlm(summary.taskId));
  const created: SeededMemory[] = [];

  const fromScenario = await agent.consolidateWithResult(summary);
  if (fromScenario) created.push({ memory: fromScenario, source: 'scenario username-regex' });

  const cases = await loadStaleSet(STALE_SET_FILE);
  for (const id of SEED_CASES) {
    const c = cases.find((x) => x.id === id);
    if (!c) throw new Error(`Seed case "${id}" is missing from ${STALE_SET_FILE}`);
    const memory = await agent.storeNote(c.note, {
      repo: c.repo,
      commit: c.commit,
      sourceTaskId: `stale-set__${c.id}`,
    });
    created.push({ memory, source: `stale-set ${c.id}` });
  }

  return {
    created,
    summaryNotes: summary.notes.length,
    scenarioStored: fromScenario !== null,
    tokens: agent.usage.tokensIn + agent.usage.tokensOut,
  };
}

export async function seedCommand(ctx: MemoryContext): Promise<string> {
  const { created, summaryNotes, scenarioStored, tokens } = await seedMemories(ctx);

  const progress = renderStageProgress([
    { name: 'Clear store/memory', status: 'success' },
    {
      name: 'Replay scenario',
      status: scenarioStored ? 'success' : 'failed',
      detail: `${summaryNotes} summary notes from username-regex.json`,
    },
    {
      name: 'Consolidate',
      status: scenarioStored ? 'success' : 'failed',
      detail: `mock model, ${tokens} tokens`,
    },
    {
      name: 'Add stale-set notes',
      status: 'success',
      detail: `${SEED_CASES.length} notes, each verified at its commit`,
    },
  ]);

  const rows = created.map(({ memory, source }) => [
    memory.memory_id,
    shorten(source, 34),
    memory.verified_at_commit,
    memory.verification.status,
  ]);
  const table = renderStatusTable(
    ['ID', 'Source', 'Checked at', 'Status'],
    rows,
    3,
    created.map((c) => c.memory.verification.status),
    `Seeded ${created.length} memories`,
  );

  return [
    progress,
    '',
    table,
    statusSummary(created.map((c) => c.memory)),
    ctx.runnerLine(),
    dim(`Store: ${path.join(ctx.storeDir, 'memory')}`),
  ].join('\n');
}
