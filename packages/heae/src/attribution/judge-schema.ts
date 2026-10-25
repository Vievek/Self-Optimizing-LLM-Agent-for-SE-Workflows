import { z } from 'zod';

export const JudgeFindingSchema = z
  .object({
    category: z.enum(['prompt', 'tool', 'retrieval', 'planning', 'workflow']),
    assessment: z.enum(['supported', 'insufficient_evidence']),
    explanation: z.string().min(1),
    evidenceNodeIds: z.array(z.string()).min(1),
    limitations: z.array(z.string()),
  })
  .strict();

export const JudgeResponseSchema = z
  .object({
    findings: z.array(JudgeFindingSchema),
    overallUncertainty: z.string().min(1),
  })
  .strict();

export type JudgeResponse = z.infer<typeof JudgeResponseSchema>;
