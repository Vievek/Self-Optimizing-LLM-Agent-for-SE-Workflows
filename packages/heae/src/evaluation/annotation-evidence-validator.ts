import type { TraceGraph } from '../trace-graph.js';
import { GroundTruthAnnotationSchema, type GroundTruthAnnotation } from './ground-truth-schema.js';

export type AnnotationValidationIssueCode =
  'MISSING_CATEGORY_EVIDENCE_SPAN' | 'MISSING_CAUSAL_EVIDENCE_SPAN' | 'OUTCOME_MISMATCH';

export interface AnnotationValidationIssue {
  code: AnnotationValidationIssueCode;
  message: string;
}

export interface AnnotationEvidenceValidationResult {
  valid: boolean;
  traceId: string;
  caseId: string;
  actualOutcome: GroundTruthAnnotation['observedOutcome'];
  issues: AnnotationValidationIssue[];
  warnings: string[];
}

/**
 * Returns the final recorded task outcome.
 * Uses the same end-timestamp ordering as HEAE attribution.
 */
function getRecordedOutcome(graph: TraceGraph): GroundTruthAnnotation['observedOutcome'] {
  const outputs = graph.nodes
    .filter((node) => node.span.name === 'output')
    .sort((a, b) => Date.parse(a.span.end_ts) - Date.parse(b.span.end_ts));

  const finalOutput = outputs[outputs.length - 1];

  if (!finalOutput || finalOutput.span.name !== 'output') {
    return 'unknown';
  }

  return finalOutput.span.attributes.result;
}

/**
 * Validate an annotation against an already parsed
 * and constructed execution trace graph.
 *
 * This checks evidence existence and outcome consistency.
 * It does not establish semantic evidence quality,
 * annotation independence or causal correctness.
 */
export function validateAnnotationEvidence(
  graph: TraceGraph,
  rawAnnotation: unknown,
): AnnotationEvidenceValidationResult {
  const annotation = GroundTruthAnnotationSchema.parse(rawAnnotation);

  const availableSpanIds = new Set(graph.nodes.map((node) => node.id));

  const issues: AnnotationValidationIssue[] = [];

  for (const entry of annotation.categoryEvidence) {
    for (const spanId of entry.spanIds) {
      if (!availableSpanIds.has(spanId)) {
        issues.push({
          code: 'MISSING_CATEGORY_EVIDENCE_SPAN',
          message: `Category "${entry.category}" references ` + `missing span ${spanId}`,
        });
      }
    }
  }

  for (const assessment of annotation.causalAssessments) {
    for (const spanId of assessment.evidenceSpanIds) {
      if (!availableSpanIds.has(spanId)) {
        issues.push({
          code: 'MISSING_CAUSAL_EVIDENCE_SPAN',
          message:
            `Causal assessment "${assessment.category}" ` + `references missing span ${spanId}`,
        });
      }
    }
  }

  const actualOutcome = getRecordedOutcome(graph);

  if (annotation.observedOutcome !== actualOutcome) {
    issues.push({
      code: 'OUTCOME_MISMATCH',
      message:
        `Annotated outcome "${annotation.observedOutcome}" ` +
        `does not match recorded outcome "${actualOutcome}"`,
    });
  }

  return {
    valid: issues.length === 0,
    traceId: graph.traceId,
    caseId: annotation.caseId,
    actualOutcome,
    issues,
    warnings: [...graph.warnings],
  };
}
