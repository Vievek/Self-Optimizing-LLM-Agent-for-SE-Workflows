import { z } from 'zod';

export const OUTCOME_EVIDENCE_SCHEMA_VERSION = '2.0' as const;

export const OutcomeDetailsSchema = z.object({
  resolved: z.boolean(),
  tests_passed: z.number().int().nonnegative(),
  tests_failed: z.number().int().nonnegative(),
  patch_applied: z.boolean(),
});

export const MemoryUseRecordSchema = z.object({
  memory_id: z.string().regex(/^mem_/),
  retrieved_span_id: z.string().regex(/^[0-9a-f]{16}$/),
  cited_by_node_ids: z.array(z.string()),
  implicated_in_failure: z.boolean(),
});

export const FailureLabelSchema = z.object({
  class: z.enum(['prompt', 'tool', 'retrieval', 'planning', 'workflow']),
  node_ids: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const ExecutionCostSchema = z.object({
  tokens_in: z.number().int().nonnegative(),
  tokens_out: z.number().int().nonnegative(),
  wall_ms: z.number().nonnegative(),
});

export const OutcomeEvidenceSchema = z.object({
  schema_version: z.literal(OUTCOME_EVIDENCE_SCHEMA_VERSION),
  evidence_id: z.string().regex(/^ev_/),
  run_id: z.string(),
  task_id: z.string(),
  trace_id: z.string().regex(/^[0-9a-f]{32}$/),
  repo: z.string(),
  base_commit: z.string(),
  outcome: OutcomeDetailsSchema,
  memory_uses: z.array(MemoryUseRecordSchema).default([]),
  failure_labels: z.array(FailureLabelSchema).default([]),
  cost: ExecutionCostSchema,
});

export type OutcomeDetails = z.infer<typeof OutcomeDetailsSchema>;
export type MemoryUseRecord = z.infer<typeof MemoryUseRecordSchema>;
export type FailureLabel = z.infer<typeof FailureLabelSchema>;
export type ExecutionCost = z.infer<typeof ExecutionCostSchema>;
export type OutcomeEvidence = z.infer<typeof OutcomeEvidenceSchema>;
