import fs from 'node:fs';
import { z } from 'zod';
import {
  MemoryNoteSchema,
  MemoryVerificationStatusSchema,
  type MemoryVerificationStatus,
} from '@soa/contracts';
import type { CodeVerifier } from '../verify/verifier.js';

// MemoryNote with no defaults and no extra keys: every field must be written out in the case file,
// so a typo or a missing field fails validation instead of being filled in.
const CaseNoteSchema = MemoryNoteSchema.extend({
  fix_snippet: z.string(),
  evidence_tests: z.array(z.string()),
  keywords: z.array(z.string()),
  tags: z.array(z.string()),
}).strict();

/** One labelled note: the status the verifier SHOULD give it at `commit`. */
export const StaleCaseSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  note: CaseNoteSchema,
  repo: z.literal('memtest/auth'),
  commit: z.string().regex(/^memtest-v\d+$/),
  expected: MemoryVerificationStatusSchema,
});

export const StaleSetSchema = z
  .array(StaleCaseSchema)
  .min(1)
  .superRefine((cases, ctx) => {
    const seen = new Set<string>();
    for (const [i, c] of cases.entries()) {
      if (seen.has(c.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, 'id'],
          message: `Duplicate id ${c.id}`,
        });
      }
      seen.add(c.id);
    }
  });

export type StaleCase = z.infer<typeof StaleCaseSchema>;

/** Reads and validates a stale-set JSON file (see fixtures/stale-set/cases.json). */
export async function loadStaleSet(file: string): Promise<StaleCase[]> {
  const json: unknown = JSON.parse(await fs.promises.readFile(file, 'utf8'));
  return StaleSetSchema.parse(json);
}

export interface StaleCaseResult {
  id: string;
  expected: MemoryVerificationStatus;
  actual: MemoryVerificationStatus;
  correct: boolean;
  details: string;
  durationMs: number;
}

export interface StaleSetSummary {
  total: number;
  correct: number;
  /** correct / total (0 when there are no cases). */
  accuracy: number;
  staleExpected: number;
  /** Cases expected stale that the verifier flagged stale. */
  staleCaught: number;
  /** staleCaught / staleExpected (0 when no case is expected stale). */
  catchRate: number;
  verifiedExpected: number;
  /** Cases expected verified that the verifier flagged stale. */
  falseAlarms: number;
  avgDurationMs: number;
}

export interface StaleSetReport {
  cases: StaleCaseResult[];
  summary: StaleSetSummary;
}

const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d);

export function summarizeStaleSet(results: StaleCaseResult[]): StaleSetSummary {
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const staleExpected = results.filter((r) => r.expected === 'stale').length;
  const staleCaught = results.filter((r) => r.expected === 'stale' && r.actual === 'stale').length;
  const verifiedExpected = results.filter((r) => r.expected === 'verified').length;
  const falseAlarms = results.filter(
    (r) => r.expected === 'verified' && r.actual === 'stale',
  ).length;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  return {
    total,
    correct,
    accuracy: ratio(correct, total),
    staleExpected,
    staleCaught,
    catchRate: ratio(staleCaught, staleExpected),
    verifiedExpected,
    falseAlarms,
    avgDurationMs: ratio(totalMs, total),
  };
}

/**
 * Verifies every case's note at its commit and compares the status with the expected one.
 * Cases run one at a time: the fixture sandbox names workspaces by timestamp.
 */
export async function evaluateStaleSet(
  verifier: Pick<CodeVerifier, 'verify'>,
  cases: StaleCase[],
): Promise<StaleSetReport> {
  const results: StaleCaseResult[] = [];
  for (const c of cases) {
    const out = await verifier.verify(c.note, c.repo, c.commit);
    results.push({
      id: c.id,
      expected: c.expected,
      actual: out.status,
      correct: out.status === c.expected,
      details: out.details,
      durationMs: out.durationMs,
    });
  }
  return { cases: results, summary: summarizeStaleSet(results) };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Plain-text table plus summary lines, for the TUI. */
export function formatStaleSetReport(report: StaleSetReport): string {
  const headers = ['Case', 'Expected', 'Actual', 'OK', 'ms'];
  const rows = report.cases.map((r) => [
    r.id,
    r.expected,
    r.actual,
    r.correct ? 'yes' : 'NO',
    String(r.durationMs),
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const line = (cells: string[]) =>
    cells
      .map((cell, i) =>
        i === cells.length - 1 ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!),
      )
      .join('  ');
  const table = [line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)];

  const s = report.summary;
  const misses = report.cases.filter((r) => !r.correct);
  const summary = [
    `Catch rate:   ${pct(s.catchRate)} (${s.staleCaught}/${s.staleExpected} stale notes caught)`,
    `False alarms: ${s.falseAlarms} (of ${s.verifiedExpected} notes expected verified)`,
    `Accuracy:     ${pct(s.accuracy)} (${s.correct}/${s.total} cases)`,
    `Avg time:     ${s.avgDurationMs.toFixed(1)} ms per case`,
  ];
  const missLines =
    misses.length === 0
      ? []
      : [
          '',
          'Mismatches:',
          ...misses.map((r) => `  ${r.id}: expected ${r.expected}, got ${r.actual}. ${r.details}`),
        ];
  return [...table, '', ...summary, ...missLines].join('\n');
}
