import { z } from 'zod';

export const REFINED_MEMORY_SCHEMA_VERSION = '1.0' as const;

export const MemoryActionSchema = z.enum(['KEEP', 'STRENGTHEN', 'COMPRESS', 'DELETE']);

export const MemoryVerificationStatusSchema = z.enum([
  'verified',
  'stale',
  'unverifiable',
  'not_applicable',
]);

// DELETE is a soft delete: the note leaves retrieval but stays as an audit tombstone ('pruned').
export const MemoryLifecycleSchema = z.enum(['active', 'compressed', 'pruned']);

export const MemoryNoteSchema = z.object({
  task: z.string(),
  problem: z.string(),
  cause: z.string(),
  files: z.array(z.string()),
  fix: z.string(),
  // Exact text the verifier searches for in the files above.
  fix_snippet: z.string().default(''),
  evidence: z.string(),
  // Exact test IDs the verifier runs, e.g. "tests/test_auth.py::test_login".
  evidence_tests: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export const MemoryVerificationSchema = z.object({
  status: MemoryVerificationStatusSchema,
  checked_at: z.string().datetime(),
  details: z.string(),
});

// Every score dimension and the total are in the range 0..1.
const unit = z.number().min(0).max(1);

export const MemoryScoreSchema = z.object({
  relevance: unit,
  correctness: unit,
  evidence: unit,
  freshness: unit,
  task_contribution: unit,
  total: unit,
});

// total = weighted average of the five dimensions (weights sum to 1).
export const SCORE_WEIGHTS = {
  relevance: 0.25,
  correctness: 0.3,
  evidence: 0.15,
  freshness: 0.15,
  task_contribution: 0.15,
} as const;

export function computeTotalScore(s: Omit<z.infer<typeof MemoryScoreSchema>, 'total'>): number {
  return (
    s.relevance * SCORE_WEIGHTS.relevance +
    s.correctness * SCORE_WEIGHTS.correctness +
    s.evidence * SCORE_WEIGHTS.evidence +
    s.freshness * SCORE_WEIGHTS.freshness +
    s.task_contribution * SCORE_WEIGHTS.task_contribution
  );
}

export const RefinedMemorySchema = z.object({
  schema_version: z.literal(REFINED_MEMORY_SCHEMA_VERSION),
  memory_id: z.string().regex(/^mem_/),
  repo: z.string(),
  source_task_id: z.string(),
  verified_at_commit: z.string(),
  note: MemoryNoteSchema,
  links: z.array(z.string().regex(/^mem_/)).default([]),
  verification: MemoryVerificationSchema,
  score: MemoryScoreSchema,
  action: MemoryActionSchema,
  lifecycle: MemoryLifecycleSchema,
  use_count: z.number().int().nonnegative().default(0),
});

export interface ConsolidatedTaskSummary {
  taskId: string;
  repo: string;
  baseCommit: string;
  resolved: boolean;
  notes: string[];
}

export interface MemoryService {
  retrieve(query: string, repo: string, commit: string): Promise<RefinedMemory[]>;
  consolidate(summary: ConsolidatedTaskSummary): Promise<void>;
}

export type MemoryAction = z.infer<typeof MemoryActionSchema>;
export type MemoryVerificationStatus = z.infer<typeof MemoryVerificationStatusSchema>;
export type MemoryLifecycle = z.infer<typeof MemoryLifecycleSchema>;
export type MemoryNote = z.infer<typeof MemoryNoteSchema>;
export type MemoryScore = z.infer<typeof MemoryScoreSchema>;
export type RefinedMemory = z.infer<typeof RefinedMemorySchema>;
