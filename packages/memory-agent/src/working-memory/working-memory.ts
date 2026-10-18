import type { ConsolidatedTaskSummary } from '@soa/contracts';

export interface TestStatus {
  id: string;
  passed: boolean;
}

export interface ExploreStep {
  action: string;
  observation: string;
  files?: string[];
  tests?: TestStatus[];
}

export type FocusOutcome = 'success' | 'partial' | 'dead_end';

export interface FocusSummary {
  topic: string;
  tried: string[];
  learned: string;
  outcome: FocusOutcome;
  files: string[];
  tests: TestStatus[];
}

/** A summary note read back from text. outcome is null when the line is missing or unknown. */
export type ParsedSummaryNote = Omit<FocusSummary, 'outcome'> & { outcome: FocusOutcome | null };

export interface WorkingMemoryOptions {
  taskId: string;
  repo: string;
  baseCommit: string;
}

interface OpenFocus {
  topic: string;
  steps: ExploreStep[];
}

const OUTCOMES: readonly FocusOutcome[] = ['success', 'partial', 'dead_end'];

// Each value lives on one line of the note, so newlines are collapsed to keep the format parseable.
function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

/**
 * Focus-style working memory: raw exploration steps are held only while a focus block is open.
 * completeFocus() compresses them into a FocusSummary and drops the raw steps, so context
 * shrinks while the learned knowledge stays.
 */
export class WorkingMemory {
  readonly taskId: string;
  readonly repo: string;
  readonly baseCommit: string;
  private current: OpenFocus | null = null;
  private readonly knowledge: FocusSummary[] = [];

  constructor(options: WorkingMemoryOptions) {
    this.taskId = options.taskId;
    this.repo = options.repo;
    this.baseCommit = options.baseCommit;
  }

  startFocus(topic: string): void {
    if (this.current) {
      throw new Error(
        `Cannot start focus "${topic}": focus "${this.current.topic}" is still open`,
      );
    }
    this.current = { topic, steps: [] };
  }

  explore(step: ExploreStep): void {
    if (!this.current) {
      throw new Error('Cannot record an explore step: no focus block is open');
    }
    this.current.steps.push({
      ...step,
      files: step.files ? [...step.files] : undefined,
      tests: step.tests ? step.tests.map((t) => ({ ...t })) : undefined,
    });
  }

  completeFocus({ learned, outcome }: { learned: string; outcome: FocusOutcome }): FocusSummary {
    if (!this.current) {
      throw new Error('Cannot complete focus: no focus block is open');
    }
    const { topic, steps } = this.current;

    const files = [...new Set(steps.flatMap((s) => s.files ?? []))];
    // Map keeps first-seen order; later steps overwrite the status.
    const testStatus = new Map<string, boolean>();
    for (const t of steps.flatMap((s) => s.tests ?? [])) {
      testStatus.set(t.id, t.passed);
    }

    const summary: FocusSummary = {
      topic,
      tried: steps.map((s) => s.action),
      learned,
      outcome,
      files,
      tests: [...testStatus].map(([id, passed]) => ({ id, passed })),
    };

    // Withdraw: the raw steps are dropped, only the summary stays.
    this.current = null;
    this.knowledge.push(summary);
    return summary;
  }

  getKnowledge(): FocusSummary[] {
    return this.knowledge.map((s) => ({
      ...s,
      tried: [...s.tried],
      files: [...s.files],
      tests: s.tests.map((t) => ({ ...t })),
    }));
  }

  /** Raw steps currently held plus completed summaries. */
  getContextSize(): number {
    return (this.current?.steps.length ?? 0) + this.knowledge.length;
  }

  finish({ resolved }: { resolved: boolean }): ConsolidatedTaskSummary {
    if (this.current) {
      throw new Error(`Cannot finish: focus "${this.current.topic}" is still open`);
    }
    return {
      taskId: this.taskId,
      repo: this.repo,
      baseCommit: this.baseCommit,
      resolved,
      notes: this.knowledge.map(formatSummaryNote),
    };
  }
}

export function formatSummaryNote(summary: FocusSummary): string {
  return [
    `TOPIC: ${oneLine(summary.topic)}`,
    `TRIED: ${summary.tried.map(oneLine).join('; ')}`,
    `LEARNED: ${oneLine(summary.learned)}`,
    `OUTCOME: ${summary.outcome}`,
    `FILES: ${summary.files.join(', ')}`,
    `TESTS: ${summary.tests.map((t) => `${t.id}=${t.passed ? 'pass' : 'fail'}`).join(', ')}`,
  ].join('\n');
}

function splitList(value: string | undefined, separator: string): string[] {
  if (value === undefined) return [];
  return value
    .split(separator)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** Reads a note written by finish() back into its fields. Missing lines give empty values. */
export function parseSummaryNote(text: string): ParsedSummaryNote {
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z]+):\s?(.*)$/.exec(line);
    if (match && !fields.has(match[1]!)) {
      fields.set(match[1]!, match[2]!.trim());
    }
  }

  const outcome = fields.get('OUTCOME');
  const tests: TestStatus[] = [];
  for (const entry of splitList(fields.get('TESTS'), ',')) {
    // Split on the last '=' so test ids containing '=' still parse.
    const eq = entry.lastIndexOf('=');
    if (eq <= 0) continue;
    const status = entry.slice(eq + 1).trim();
    if (status !== 'pass' && status !== 'fail') continue;
    tests.push({ id: entry.slice(0, eq).trim(), passed: status === 'pass' });
  }

  return {
    topic: fields.get('TOPIC') ?? '',
    tried: splitList(fields.get('TRIED'), ';'),
    learned: fields.get('LEARNED') ?? '',
    outcome: OUTCOMES.includes(outcome as FocusOutcome) ? (outcome as FocusOutcome) : null,
    files: splitList(fields.get('FILES'), ','),
    tests,
  };
}
