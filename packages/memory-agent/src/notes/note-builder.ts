import { MemoryNoteSchema, type ConsolidatedTaskSummary, type MemoryNote } from '@soa/contracts';
import type { ChatRequest, LlmProvider } from '@soa/llm';
import { parseSummaryNote, type ParsedSummaryNote, type TestStatus } from '../working-memory/working-memory.js';

export interface BuildNoteResult {
  note: MemoryNote;
  usedFallback: boolean;
  tokensIn: number;
  tokensOut: number;
  /** Number of model calls made (1 or 2). */
  calls: number;
}

export const FALLBACK_TAG = 'fallback';
export const UNRESOLVED_TAG = 'unresolved';

const MAX_ATTEMPTS = 2;
const MIN_KEYWORDS = 3;
const MAX_KEYWORDS = 8;
const MAX_TAGS = 4;
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'this', 'that']);

const SYSTEM_PROMPT = `You turn a software engineering task summary into one memory note.
Reply with ONLY a JSON object, no prose and no markdown, with exactly these fields:
{
  "task": string,           // one-line description of the task
  "problem": string,        // the observed problem
  "cause": string,          // the root cause
  "files": string[],        // files that were changed
  "fix": string,            // what the fix does
  "fix_snippet": string,    // a short exact code line from the fix, or "" if unknown
  "evidence": string,       // why we believe the fix works
  "evidence_tests": string[], // exact test ids that passed
  "keywords": string[],     // ${MIN_KEYWORDS} to ${MAX_KEYWORDS} lowercase keywords
  "tags": string[]          // 1 to ${MAX_TAGS} short tags
}
fix_snippet must be copied exactly from the code, never paraphrased. Use "" if you do not know it.`;

interface CollectedFacts {
  parsed: ParsedSummaryNote[];
  files: string[];
  tests: TestStatus[];
}

function collectFacts(summary: ConsolidatedTaskSummary): CollectedFacts {
  const parsed = summary.notes.map(parseSummaryNote);
  const files = [...new Set(parsed.flatMap((p) => p.files))];
  // Later notes overwrite the status of a test seen earlier.
  const status = new Map<string, boolean>();
  for (const t of parsed.flatMap((p) => p.tests)) {
    status.set(t.id, t.passed);
  }
  return { parsed, files, tests: [...status].map(([id, passed]) => ({ id, passed })) };
}

function buildUserPrompt(summary: ConsolidatedTaskSummary): string {
  return [
    `Task id: ${summary.taskId}`,
    `Repository: ${summary.repo}`,
    `Resolved: ${summary.resolved ? 'yes' : 'no'}`,
    '',
    'Task summary:',
    summary.notes.join('\n\n'),
  ].join('\n');
}

function stripFences(text: string): string {
  const fenced = /^\s*```[a-zA-Z]*\s*\n?([\s\S]*?)\n?\s*```\s*$/.exec(text);
  return (fenced ? fenced[1]! : text).trim();
}

/** Returns the validated note, or the error message to show the model on retry. */
function parseReply(content: string): { note: MemoryNote } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(stripFences(content));
  } catch (err) {
    return { error: `Reply is not valid JSON: ${(err as Error).message}` };
  }
  const result = MemoryNoteSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    return { error: `Reply does not match the note schema: ${issues.join('; ')}` };
  }
  return { note: result.data };
}

function uniqueLower(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim().toLowerCase()).filter((v) => v.length > 0))];
}

function buildFallbackNote(summary: ConsolidatedTaskSummary, facts: CollectedFacts): MemoryNote {
  const learned = facts.parsed
    .map((p) => p.learned)
    .filter((l) => l.length > 0)
    .join(' ');
  const passing = facts.tests.filter((t) => t.passed).map((t) => t.id);
  const topicWords = facts.parsed
    .flatMap((p) => p.topic.toLowerCase().split(/[^a-z0-9_]+/))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

  return {
    task: summary.taskId,
    problem: facts.parsed[0]?.topic ?? '',
    cause: learned,
    files: facts.files,
    fix: learned,
    fix_snippet: '',
    evidence: passing.length > 0 ? `Passing tests: ${passing.join(', ')}` : '',
    evidence_tests: passing,
    keywords: uniqueLower(topicWords).slice(0, MAX_KEYWORDS),
    tags: [FALLBACK_TAG],
  };
}

export async function buildNote(
  summary: ConsolidatedTaskSummary,
  llm: LlmProvider,
  model: string,
): Promise<BuildNoteResult> {
  const facts = collectFacts(summary);
  const userPrompt = buildUserPrompt(summary);

  let tokensIn = 0;
  let tokensOut = 0;
  let calls = 0;
  let note: MemoryNote | null = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS && !note; attempt++) {
    const messages: ChatRequest['messages'] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];
    if (lastError) {
      messages.push({
        role: 'user',
        content: `Your previous reply was invalid. ${lastError}\nReply again with ONLY the corrected JSON object.`,
      });
    }

    const response = await llm.chat({ model, messages, temperature: 0 });
    calls++;
    tokensIn += response.tokensIn;
    tokensOut += response.tokensOut;

    const parsed = parseReply(response.content);
    if ('note' in parsed) {
      note = parsed.note;
    } else {
      lastError = parsed.error;
    }
  }

  const usedFallback = note === null;
  const result: MemoryNote = note
    ? {
        ...note,
        // Structured data from the summary lines wins over what the model said.
        files: facts.files,
        evidence_tests: facts.tests.filter((t) => t.passed).map((t) => t.id),
        keywords: uniqueLower(note.keywords).slice(0, MAX_KEYWORDS),
        tags: uniqueLower(note.tags).slice(0, MAX_TAGS),
      }
    : buildFallbackNote(summary, facts);

  if (!summary.resolved && !result.tags.includes(UNRESOLVED_TAG)) {
    result.tags = [...result.tags, UNRESOLVED_TAG];
  }

  return { note: MemoryNoteSchema.parse(result), usedFallback, tokensIn, tokensOut, calls };
}
