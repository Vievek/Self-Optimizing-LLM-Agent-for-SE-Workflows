import { z } from 'zod';

const FailureCategorySchema = z.enum(['prompt', 'tool', 'retrieval', 'planning', 'workflow']);

const SpanIdSchema = z
  .string()
  .regex(/^[0-9a-f]{16}$/, 'Span ID must be 16 lowercase hexadecimal characters');

const SafeTraceFileSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value.endsWith('.jsonl') &&
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.split('/').some((part) => part === '' || part === '.' || part === '..'),
    'Trace filename must be a safe relative JSONL path',
  );

export const CategoryEvidenceSchema = z
  .object({
    category: FailureCategorySchema,
    spanIds: z.array(SpanIdSchema).min(1),
    justification: z.string().trim().min(1),
  })
  .strict();

export const CausalAssessmentSchema = z
  .object({
    category: FailureCategorySchema,
    judgment: z.enum(['supported', 'contradicted', 'insufficient_evidence']),
    explanation: z.string().trim().min(1),
    evidenceSpanIds: z.array(SpanIdSchema),
  })
  .strict();

export const GroundTruthAnnotationSchema = z
  .object({
    caseId: z.string().trim().min(1),
    traceFile: SafeTraceFileSchema,
    observedOutcome: z.enum(['pass', 'fail', 'error', 'unknown']),
    expectedCategories: z.array(FailureCategorySchema),
    categoryEvidence: z.array(CategoryEvidenceSchema),
    causalAssessments: z.array(CausalAssessmentSchema),
    limitations: z.array(z.string().trim().min(1)),
    annotationStatus: z.enum(['draft', 'reviewed', 'adjudicated']),
    datasetProvenance: z.enum(['synthetic_development', 'synthetic_independent', 'real_execution']),
  })
  .strict()
  .superRefine((annotation, context) => {
    const labels = new Set(annotation.expectedCategories);

    if (labels.size !== annotation.expectedCategories.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedCategories'],
        message: 'Duplicate expected failure category',
      });
    }

    const evidenceCategories = new Set<string>();

    annotation.categoryEvidence.forEach((evidence, index) => {
      if (evidenceCategories.has(evidence.category)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['categoryEvidence', index],
          message: 'Duplicate category evidence',
        });
      }

      evidenceCategories.add(evidence.category);

      if (!labels.has(evidence.category)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['categoryEvidence', index],
          message: 'Evidence category has no expected label',
        });
      }

      if (new Set(evidence.spanIds).size !== evidence.spanIds.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['categoryEvidence', index, 'spanIds'],
          message: 'Duplicate evidence span ID',
        });
      }
    });

    for (const category of labels) {
      if (!evidenceCategories.has(category)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['categoryEvidence'],
          message: `Missing evidence for category: ${category}`,
        });
      }
    }

    const assessedCategories = new Set<string>();

    annotation.causalAssessments.forEach((assessment, index) => {
      if (assessedCategories.has(assessment.category)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['causalAssessments', index],
          message: 'Duplicate causal assessment',
        });
      }

      assessedCategories.add(assessment.category);

      if (!labels.has(assessment.category)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['causalAssessments', index],
          message: 'Causal assessment category has no expected label',
        });
      }

      if (new Set(assessment.evidenceSpanIds).size !== assessment.evidenceSpanIds.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['causalAssessments', index, 'evidenceSpanIds'],
          message: 'Duplicate causal evidence span ID',
        });
      }

      if (
        assessment.judgment !== 'insufficient_evidence' &&
        assessment.evidenceSpanIds.length === 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['causalAssessments', index, 'evidenceSpanIds'],
          message: 'Causal judgment requires supporting evidence',
        });
      }
    });
  });

export type GroundTruthAnnotation = z.infer<typeof GroundTruthAnnotationSchema>;
