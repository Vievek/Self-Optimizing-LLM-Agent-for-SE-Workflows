
import { z } from 'zod';
import type { Store } from '@soa/store';

import type {
  HybridAttributionResult,
} from '../attribution/hybrid-attribution.js';

import { JudgeResponseSchema } from '../attribution/judge-schema.js';

const TraceIdSchema = z.string().regex(/^[0-9a-f]{32}$/);

const FailureCategorySchema = z.enum([
  'prompt',
  'tool',
  'retrieval',
  'planning',
  'workflow',
]);

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

export const StoredEvaluationSchema = z.object({
  schemaVersion: z.literal('1.0'),
  traceId: TraceIdSchema,

  traceFingerprint: z.string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
    
  result: z.object({
    traceId: TraceIdSchema,
      traceFingerprint: z.string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
    ruleReport: AttributionReportSchema,
    judgment: JudgeResponseSchema.nullable(),
    judgeStatus: z.enum([
      'completed',
      'skipped',
      'unavailable',
    ]),
    warnings: z.array(z.string()),
  }),
}).superRefine((record, context) => {
  if (
    record.traceId !== record.result.traceId ||
    record.traceId !== record.result.ruleReport.traceId
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Trace IDs must match.',
    });
  }

  if (
    record.result.judgeStatus === 'completed' &&
    record.result.judgment === null
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Completed judgment must contain a result.',
    });
  }

  if (
    record.result.judgeStatus !== 'completed' &&
    record.result.judgment !== null
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Non-completed judgment must be null.',
    });
  }
});

export type StoredEvaluation =
  z.infer<typeof StoredEvaluationSchema>;

export class EvaluationHistory {
  constructor(private readonly store: Store) {}

  private pathFor(traceId: string): string {
    const validTraceId = TraceIdSchema.parse(traceId);
    return `heae/evaluations/${validTraceId}.json`;
  }

  
  async save(
    result: HybridAttributionResult,
    traceFingerprint?: string,
  ): Promise<StoredEvaluation> {
    const record = StoredEvaluationSchema.parse({
      schemaVersion: '1.0',
      traceId: result.traceId,
      ...(traceFingerprint !== undefined
        ? { traceFingerprint }
        : {}),
      result,
    });

    const path = this.pathFor(record.traceId);

    if (await this.store.exists(path)) {
      throw new Error(
        `Evaluation already exists for trace ${record.traceId}`,
      );
    }

    await this.store.write(path, record);

    return record;
  }


  async load(
    traceId: string,
  ): Promise<StoredEvaluation | null> {
    const path = this.pathFor(traceId);

    if (!(await this.store.exists(path))) {
      return null;
    }

    const raw = await this.store.read<unknown>(path);

    return StoredEvaluationSchema.parse(raw);
  }

  async list(): Promise<StoredEvaluation[]> {
    const prefix = 'heae/evaluations/';
    const paths = await this.store.list(prefix);
    const results: StoredEvaluation[] = [];

    for (const path of paths) {
      const match = /^heae\/evaluations\/([0-9a-f]{32})\.json$/
        .exec(path);

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
