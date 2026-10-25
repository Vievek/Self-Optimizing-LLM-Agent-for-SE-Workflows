import { z } from 'zod';

import { GroundTruthAnnotationSchema, type GroundTruthAnnotation } from './ground-truth-schema.js';

import { validateAnnotationEvidence } from './annotation-evidence-validator.js';

import {
  runResearchEvaluation,
  type ResearchEvaluationReport,
} from './research-evaluation-runner.js';

export const AnnotatedResearchManifestSchema = z
  .object({
    datasetName: z.string().trim().min(1),
    datasetVersion: z.string().trim().min(1),
    annotations: z.array(GroundTruthAnnotationSchema).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const ids = new Set<string>();

    manifest.annotations.forEach((annotation, index) => {
      if (ids.has(annotation.caseId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['annotations', index, 'caseId'],
          message: `Duplicate case ID: ${annotation.caseId}`,
        });
      }

      ids.add(annotation.caseId);
    });
  });

export type AnnotatedResearchManifest = z.infer<typeof AnnotatedResearchManifestSchema>;

export interface AnnotationReportEntry {
  caseId: string;
  traceFile: string;
  annotationStatus: GroundTruthAnnotation['annotationStatus'];
  datasetProvenance: GroundTruthAnnotation['datasetProvenance'];
}

export interface AnnotatedResearchReport extends ResearchEvaluationReport {
  annotationValidation: {
    validatedCases: number;
    allEvidenceReferencesValid: boolean;
    entries: AnnotationReportEntry[];
  };
}

/**
 * Evaluate annotated traces only after their
 * structural and evidence checks succeed.
 *
 * Draft annotations are rejected because they
 * have not completed the annotation review stage.
 */
export async function runAnnotatedResearchEvaluation(
  datasetDirectory: string,
  rawManifest: unknown,
): Promise<AnnotatedResearchReport> {
  const manifest = AnnotatedResearchManifestSchema.parse(rawManifest);

  for (const annotation of manifest.annotations) {
    if (annotation.annotationStatus === 'draft') {
      throw new Error(`Research case "${annotation.caseId}" has a draft annotation`);
    }
  }

  const annotationsById = new Map(
    manifest.annotations.map((annotation) => [annotation.caseId, annotation]),
  );

  const evaluationManifest = {
    datasetName: manifest.datasetName,
    datasetVersion: manifest.datasetVersion,
    cases: manifest.annotations.map((annotation) => ({
      id: annotation.caseId,
      traceFile: annotation.traceFile,
      expectedCategories: annotation.expectedCategories,
    })),
  };

  const report = await runResearchEvaluation(datasetDirectory, evaluationManifest, (testCase) => {
    const annotation = annotationsById.get(testCase.id);

    if (!annotation) {
      throw new Error(`Missing annotation for case "${testCase.id}"`);
    }

    const validation = validateAnnotationEvidence(testCase.graph, annotation);

    if (!validation.valid) {
      const reasons = validation.issues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join('; ');

      throw new Error(`Annotation validation failed for case "${testCase.id}": ${reasons}`);
    }
  });

  return {
    ...report,
    annotationValidation: {
      validatedCases: manifest.annotations.length,
      allEvidenceReferencesValid: true,
      entries: manifest.annotations.map((annotation) => ({
        caseId: annotation.caseId,
        traceFile: annotation.traceFile,
        annotationStatus: annotation.annotationStatus,
        datasetProvenance: annotation.datasetProvenance,
      })),
    },
  };
}
