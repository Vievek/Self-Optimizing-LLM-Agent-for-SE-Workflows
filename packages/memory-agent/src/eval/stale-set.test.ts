import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MemoryNote, MemoryVerificationStatus } from '@soa/contracts';
import {
  evaluateStaleSet,
  formatStaleSetReport,
  loadStaleSet,
  StaleSetSchema,
  summarizeStaleSet,
  type StaleCase,
  type StaleCaseResult,
  type StaleSetReport,
} from './stale-set.js';
import { CodeVerifier, type VerificationOutcome } from '../verify/verifier.js';
import { makeFixtureSandbox, STALE_SET_FILE } from '../test-utils/fixture-repos.js';

describe('stale set fixture', () => {
  let cases: StaleCase[];
  beforeAll(async () => {
    cases = await loadStaleSet(STALE_SET_FILE);
  });

  it('loads, validates and has at least 12 cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
  });

  it('covers every status and every fixture commit', () => {
    const statuses = new Set(cases.map((c) => c.expected));
    expect([...statuses].sort()).toEqual(['not_applicable', 'stale', 'unverifiable', 'verified']);
    const commits = new Set(cases.map((c) => c.commit));
    for (const v of [1, 2, 3, 4, 5]) expect(commits).toContain(`memtest-v${v}`);
  });

  describe('schema', () => {
    const raw = () => JSON.parse(fs.readFileSync(STALE_SET_FILE, 'utf8')) as StaleCase[];

    it('rejects an unknown expected status', () => {
      const bad = raw();
      (bad[0] as { expected: string }).expected = 'maybe';
      expect(() => StaleSetSchema.parse(bad)).toThrow();
    });

    it('rejects a note missing a field or with an unknown field', () => {
      const missing = raw();
      delete (missing[0]!.note as Partial<MemoryNote>).fix_snippet;
      expect(() => StaleSetSchema.parse(missing)).toThrow();

      const extra = raw();
      (extra[0]!.note as Record<string, unknown>).fixSnippet = 'x';
      expect(() => StaleSetSchema.parse(extra)).toThrow();
    });

    it('rejects duplicate ids', () => {
      const dup = raw();
      dup[1]!.id = dup[0]!.id;
      expect(() => StaleSetSchema.parse(dup)).toThrow(/Duplicate id/);
    });
  });
});

describe('evaluateStaleSet with the fake test runner', () => {
  const fixture = makeFixtureSandbox({ fakeTests: true });
  const verifier = new CodeVerifier({ sandbox: fixture.sandbox });
  let report: StaleSetReport;
  afterAll(() => fixture.cleanup());

  beforeAll(async () => {
    report = await evaluateStaleSet(verifier, await loadStaleSet(STALE_SET_FILE));
  });

  it('gives every case its expected status', () => {
    const wrong = report.cases.filter((r) => !r.correct);
    expect(wrong).toEqual([]);
    for (const r of report.cases) expect(r.actual, r.id).toBe(r.expected);
  });

  it('catches every stale note with no false alarms', () => {
    expect(report.summary.staleExpected).toBeGreaterThanOrEqual(5);
    expect(report.summary.catchRate).toBe(1);
    expect(report.summary.falseAlarms).toBe(0);
    expect(report.summary.accuracy).toBe(1);
  });

  it('formats a table and the summary lines', () => {
    const text = formatStaleSetReport(report);
    for (const r of report.cases) expect(text).toContain(r.id);
    expect(text).toContain('Catch rate:   100.0%');
    expect(text).toContain('False alarms: 0');
    expect(text).toContain('Accuracy:     100.0%');
    expect(text).not.toContain('Mismatches');
  });
});

describe('stale set summary maths', () => {
  const r = (
    id: string,
    expected: MemoryVerificationStatus,
    actual: MemoryVerificationStatus,
    durationMs: number,
  ): StaleCaseResult => ({
    id,
    expected,
    actual,
    correct: expected === actual,
    details: `${id} details`,
    durationMs,
  });

  it('counts catches, false alarms and accuracy', () => {
    const summary = summarizeStaleSet([
      r('a', 'stale', 'stale', 10),
      r('b', 'stale', 'verified', 20),
      r('c', 'stale', 'unverifiable', 30),
      r('d', 'verified', 'stale', 40),
      r('e', 'verified', 'verified', 50),
      r('f', 'unverifiable', 'stale', 60),
    ]);
    expect(summary).toEqual({
      total: 6,
      correct: 2,
      accuracy: 2 / 6,
      staleExpected: 3,
      staleCaught: 1,
      catchRate: 1 / 3,
      verifiedExpected: 2,
      falseAlarms: 1,
      avgDurationMs: 35,
    });
  });

  it('is all zeros for an empty list', () => {
    expect(summarizeStaleSet([])).toMatchObject({ accuracy: 0, catchRate: 0, avgDurationMs: 0 });
  });

  it('evaluateStaleSet uses the verifier result for each case and lists mismatches', async () => {
    const note = {} as MemoryNote;
    const statuses: Record<string, MemoryVerificationStatus> = {
      'memtest-v1': 'verified',
      'memtest-v2': 'verified',
    };
    const stub = {
      verify: async (
        _n: MemoryNote,
        _repo: string,
        commit: string,
      ): Promise<VerificationOutcome> => ({
        status: statuses[commit]!,
        details: `checked ${commit}`,
        fileChecks: [],
        durationMs: 4,
      }),
    };
    const cases: StaleCase[] = [
      {
        id: 'ok',
        description: 'd',
        note,
        repo: 'memtest/auth',
        commit: 'memtest-v1',
        expected: 'verified',
      },
      {
        id: 'miss',
        description: 'd',
        note,
        repo: 'memtest/auth',
        commit: 'memtest-v2',
        expected: 'stale',
      },
    ];
    const report = await evaluateStaleSet(stub, cases);
    expect(report.cases).toEqual([
      {
        id: 'ok',
        expected: 'verified',
        actual: 'verified',
        correct: true,
        details: 'checked memtest-v1',
        durationMs: 4,
      },
      {
        id: 'miss',
        expected: 'stale',
        actual: 'verified',
        correct: false,
        details: 'checked memtest-v2',
        durationMs: 4,
      },
    ]);
    expect(report.summary).toMatchObject({ catchRate: 0, accuracy: 0.5, avgDurationMs: 4 });
    const text = formatStaleSetReport(report);
    expect(text).toContain('Catch rate:   0.0% (0/1 stale notes caught)');
    expect(text).toContain('miss: expected stale, got verified. checked memtest-v2');
  });
});
