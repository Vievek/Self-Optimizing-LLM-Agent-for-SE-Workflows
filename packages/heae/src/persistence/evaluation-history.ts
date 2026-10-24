import { z } from 'zod';
import type { Store } from '@soa/store';

import type { HybridAttributionResult } from '../attribution/hybrid-attribution.js';

import { JudgeResponseSchema } from '../attribution/judge-schema.js';

const TraceIdSchema = z.string().regex(/^[0-9a-f]{32}$/);

const FailureCategorySchema = z.enum(['prompt', 'tool', 'retrieval', 'planning', 'workflow']);

const RuleFindingSchema = z.object({
  ruleId: z.string(),
  category: FailureCategorySchema,
  observation: z.string(),
  evidenceNodeIds: z.array(z.string()),
  details: z.record(z.unknown()),
});

const AttributionHypothesisSchema = z.object({
  category: FailureCategorySchema,
  status: z.literal('unverified'),
  summary: z.string(),
  supportingRuleIds: z.array(z.string()),
  evidenceNodeIds: z.array(z.string()),
  limitations: z.array(z.string()),
});

const AttributionReportSchema = z.object({
  traceId: TraceIdSchema,
  outcome: z.enum(['pass', 'fail', 'error', 'unknown']),
  observations: z.array(RuleFindingSchema),
  hypotheses: z.array(AttributionHypothesisSchema),
  warnings: z.array(z.string()),
  requiresJudge: z.boolean(),
});

/**
 * Saved HEAE evaluation schema.
 *
 * The trace fingerprint belongs at the top level.
 *
 * Legacy evaluations without a fingerprint remain
 * readable because traceFingerprint is optional.
 */
export const StoredEvaluationSchema = z
  .object({
    schemaVersion: z.literal('1.0'),

    traceId: TraceIdSchema,

    traceFingerprint: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),

    result: z.object({
      traceId: TraceIdSchema,
      ruleReport: AttributionReportSchema,
      judgment: JudgeResponseSchema.nullable(),

      judgeStatus: z.enum(['completed', 'skipped', 'unavailable']),

      warnings: z.array(z.string()),
    }),
  })
  .superRefine((record, context) => {
    // The stored evaluation and rule report must
    // refer to the same execution trace.
    if (
      record.traceId !== record.result.traceId ||
      record.traceId !== record.result.ruleReport.traceId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Trace IDs must match.',
      });
    }

    // Completed judgments require a judgment result.
    if (record.result.judgeStatus === 'completed' && record.result.judgment === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Completed judgment must contain a result.',
      });
    }

    // Skipped or unavailable judgments must not
    // contain a completed model response.
    if (record.result.judgeStatus !== 'completed' && record.result.judgment !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Non-completed judgment must be null.',
      });
    }
  });

export type StoredEvaluation = z.infer<typeof StoredEvaluationSchema>;

/**
 * Handles HEAE evaluation history.
 *
 * Evaluations are stored under:
 *
 * heae/evaluations/<traceId>.json
 *
 * This class does not overwrite existing evaluations.
 */
export class EvaluationHistory {
  constructor(private readonly store: Store) {}

  /**
   * Construct the storage path after validating
   * the trace identifier.
   */
  private pathFor(traceId: string): string {
    const validTraceId = TraceIdSchema.parse(traceId);

    return `heae/evaluations/${validTraceId}.json`;
  }

  /**
   * Save a new evaluation report.
   *
   * The fingerprint is optional to preserve
   * compatibility with older callers.
   */
  async save(
    result: HybridAttributionResult,
    traceFingerprint?: string,
  ): Promise<StoredEvaluation> {
    const record = StoredEvaluationSchema.parse({
      schemaVersion: '1.0',

      traceId: result.traceId,

      ...(traceFingerprint !== undefined ? { traceFingerprint } : {}),

      result,
    });

    const filePath = this.pathFor(record.traceId);

    // Prevent an existing evaluation from
    // being silently overwritten.
    if (await this.store.exists(filePath)) {
      throw new Error(`Evaluation already exists for trace ${record.traceId}`);
    }

    await this.store.write(filePath, record);

    return record;
  }

  /**
   * Load an evaluation by trace ID.
   *
   * Returns null when no evaluation exists.
   * Existing records are validated before returning.
   */
  async load(traceId: string): Promise<StoredEvaluation | null> {
    const filePath = this.pathFor(traceId);

    if (!(await this.store.exists(filePath))) {
      return null;
    }

    const raw = await this.store.read<unknown>(filePath);

    return StoredEvaluationSchema.parse(raw);
  }

  /**
   * List and validate all stored HEAE evaluations.
   */
  async list(): Promise<StoredEvaluation[]> {
    const prefix = 'heae/evaluations/';

    const paths = await this.store.list(prefix);

    const results: StoredEvaluation[] = [];

    for (const filePath of paths) {
      const match = /^heae\/evaluations\/([0-9a-f]{32})\.json$/.exec(filePath);

      if (!match?.[1]) {
        continue;
      }

      const record = await this.load(match[1]);

      if (record) {
        results.push(record);
      }
    }

    return results;
  }
}
