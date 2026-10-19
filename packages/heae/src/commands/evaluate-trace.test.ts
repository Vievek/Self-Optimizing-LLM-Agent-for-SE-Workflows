
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@soa/store';

import { evaluateTrace } from './evaluate-trace.js';
import { EvaluationHistory } from '../persistence/evaluation-history.js';

const toolFixture = new URL(
  '../../fixtures/tool-error.jsonl',
  import.meta.url,
);

const successFixture = new URL(
  '../../../../fixtures/traces/success.jsonl',
  import.meta.url,
);

function readFixture(url: URL): string {
  return readFileSync(url, 'utf8');
}

describe('HEAE evaluate-trace command handler', () => {
  it('evaluates a valid JSONL trace', async () => {
    const result = await evaluateTrace(
      readFixture(toolFixture),
    );

    expect(result.summary.traceId).toMatch(
      /^[0-9a-f]{32}$/,
    );
    expect(result.summary.observationCount)
      .toBeGreaterThan(0);
    expect(result.summary.categories).toContain('tool');
    expect(result.summary.saved).toBe(false);
  });

  it('retains rule findings without an LLM provider', async () => {
    const result = await evaluateTrace(
      readFixture(toolFixture),
    );

    expect(result.summary.judgeStatus).toBe('unavailable');
    expect(result.attribution.judgment).toBeNull();
    expect(result.attribution.ruleReport.hypotheses.length)
      .toBeGreaterThan(0);
  });

  it('skips LLM judging on a clean trace', async () => {
    const result = await evaluateTrace(
      readFixture(successFixture),
    );

    expect(result.summary.judgeStatus).toBe('skipped');
    expect(result.summary.saved).toBe(false);
    expect(result.summary.observationCount).toBe(0);
  });

  it('saves evaluation history when a store is supplied', async () => {
    const store = new MemoryStore();

    const result = await evaluateTrace(
      readFixture(toolFixture),
      { store },
    );

    expect(result.summary.saved).toBe(true);

    const history = new EvaluationHistory(store);
    const saved = await history.load(
      result.summary.traceId,
    );

    expect(saved?.traceId).toBe(result.summary.traceId);
    expect(saved?.result.judgeStatus)
      .toBe('unavailable');
  });

  it('does not overwrite an existing evaluation', async () => {
    const store = new MemoryStore();
    const content = readFixture(toolFixture);

    await evaluateTrace(content, { store });

    await expect(
      evaluateTrace(content, { store }),
    ).rejects.toThrow('Evaluation already exists');
  });

  it('rejects malformed JSONL input', async () => {
    await expect(
      evaluateTrace('{not-valid-json}'),
    ).rejects.toThrow('Invalid JSON at line 1');
  });

  it('rejects empty trace input', async () => {
    await expect(
      evaluateTrace(' \n \n'),
    ).rejects.toThrow('Trace file contains no valid spans');
  });

  it('does not save an invalid trace', async () => {
    const store = new MemoryStore();

    await expect(
      evaluateTrace('{invalid}', { store }),
    ).rejects.toThrow();

    const paths = await store.list('heae/evaluations/');

    expect(paths).toEqual([]);
  });
});
