
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { FileStore, MemoryStore } from '@soa/store';

import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';
import { attributeTrace } from '../attribution/evidence-attribution.js';

import type {
  HybridAttributionResult,
} from '../attribution/hybrid-attribution.js';

import {
  EvaluationHistory,
  StoredEvaluationSchema,
} from './evaluation-history.js';

const fixturePath = new URL(
  '../../fixtures/tool-error.jsonl',
  import.meta.url,
);

function makeResult(): HybridAttributionResult {
  const source = readFileSync(fixturePath, 'utf8');
  const spans = parseTraceJsonl(source);
  const graph = buildTraceGraph(spans);
  const ruleReport = attributeTrace(graph);

  return {
    traceId: ruleReport.traceId,
    ruleReport,
    judgment: null,
    judgeStatus: 'unavailable',
    warnings: [
      ...ruleReport.warnings,
      'LLM judge unavailable during this evaluation.',
    ],
  };
}

describe('HEAE evaluation history', () => {
  it('saves and loads a rule-based evaluation', async () => {
    const history = new EvaluationHistory(new MemoryStore());
    const result = makeResult();

    const saved = await history.save(result);
    const loaded = await history.load(result.traceId);

    expect(saved.schemaVersion).toBe('1.0');
    expect(loaded).toEqual(saved);
    expect(loaded?.result.ruleReport.observations)
      .toEqual(result.ruleReport.observations);
  });

  it('preserves evidence and judge status', async () => {
    const history = new EvaluationHistory(new MemoryStore());
    const result = makeResult();

    await history.save(result);

    const loaded = await history.load(result.traceId);

    expect(loaded?.result.judgeStatus)
      .toBe('unavailable');

    expect(loaded?.result.judgment).toBeNull();

    expect(
      loaded?.result.ruleReport.hypotheses.length,
    ).toBeGreaterThan(0);
  });

  it('rejects duplicate trace evaluations', async () => {
    const history = new EvaluationHistory(new MemoryStore());
    const result = makeResult();

    await history.save(result);

    await expect(
      history.save(result),
    ).rejects.toThrow('Evaluation already exists');
  });

  it('returns null for a missing evaluation', async () => {
    const history = new EvaluationHistory(new MemoryStore());

    const result = await history.load(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );

    expect(result).toBeNull();
  });

  it('rejects invalid trace IDs', async () => {
    const history = new EvaluationHistory(new MemoryStore());

    await expect(
      history.load('../../outside'),
    ).rejects.toThrow();
  });

  it('lists saved evaluation records', async () => {
    const history = new EvaluationHistory(new MemoryStore());
    const result = makeResult();

    await history.save(result);

    const records = await history.list();

    expect(records).toHaveLength(1);
    expect(records[0]?.traceId).toBe(result.traceId);
  });

  it('rejects malformed stored records', async () => {
    const store = new MemoryStore();
    const history = new EvaluationHistory(store);
    const result = makeResult();

    await store.write(
      `heae/evaluations/${result.traceId}.json`,
      {
        schemaVersion: '1.0',
        traceId: result.traceId,
        result: { invalid: true },
      },
    );

    await expect(
      history.load(result.traceId),
    ).rejects.toThrow();
  });

  it('persists evaluation history using FileStore', async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'heae-history-'),
    );

    try {
      const result = makeResult();

      const firstStore = new FileStore(directory);
      const firstHistory = new EvaluationHistory(firstStore);

      await firstHistory.save(result);

      // Simulate a new process accessing the same directory.
      const secondStore = new FileStore(directory);
      const secondHistory = new EvaluationHistory(secondStore);

      const loaded = await secondHistory.load(result.traceId);

      expect(loaded).not.toBeNull();
      expect(loaded?.traceId).toBe(result.traceId);
      expect(
        StoredEvaluationSchema.safeParse(loaded).success,
      ).toBe(true);
    } finally {
      await rm(directory, {
        recursive: true,
        force: true,
      });
    }
  });
});
