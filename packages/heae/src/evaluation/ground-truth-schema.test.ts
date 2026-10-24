import { describe, expect, it } from 'vitest';

import { GroundTruthAnnotationSchema, type GroundTruthAnnotation } from './ground-truth-schema.js';

const TOOL_SPAN = '1000000000000006';
const OUTPUT_SPAN = '1000000000000007';

function validAnnotation(): GroundTruthAnnotation {
  return {
    caseId: 'tool-failure-001',
    traceFile: 'tool-error.jsonl',
    observedOutcome: 'fail',
    expectedCategories: ['tool'],
    categoryEvidence: [
      {
        category: 'tool',
        spanIds: [TOOL_SPAN],
        justification: 'The apply_patch operation returned a context mismatch error.',
      },
    ],
    causalAssessments: [
      {
        category: 'tool',
        judgment: 'insufficient_evidence',
        explanation: 'The error was observed, but the underlying patch mismatch cause is unknown.',
        evidenceSpanIds: [TOOL_SPAN, OUTPUT_SPAN],
      },
    ],
    limitations: ['Patch content and repository state are unavailable.'],
    annotationStatus: 'draft',
    datasetProvenance: 'synthetic_development',
  };
}

describe('HEAE ground-truth annotation schema', () => {
  it('accepts a valid tool-failure annotation', () => {
    expect(GroundTruthAnnotationSchema.parse(validAnnotation()).expectedCategories).toEqual([
      'tool',
    ]);
  });

  it('accepts a successful trace with no failure labels', () => {
    const annotation = {
      ...validAnnotation(),
      observedOutcome: 'pass',
      expectedCategories: [],
      categoryEvidence: [],
      causalAssessments: [],
      limitations: [],
    };

    expect(GroundTruthAnnotationSchema.safeParse(annotation).success).toBe(true);
  });

  it('accepts multiple supported categories', () => {
    const annotation = validAnnotation();

    annotation.expectedCategories = ['tool', 'retrieval'];
    annotation.categoryEvidence.push({
      category: 'retrieval',
      spanIds: ['1000000000000003'],
      justification: 'Required retrieval returned no results.',
    });

    expect(GroundTruthAnnotationSchema.safeParse(annotation).success).toBe(true);
  });

  it('rejects an unsupported failure category', () => {
    const annotation = {
      ...validAnnotation(),
      expectedCategories: ['network'],
    };

    expect(GroundTruthAnnotationSchema.safeParse(annotation).success).toBe(false);
  });

  it('rejects duplicate failure categories', () => {
    const annotation = validAnnotation();
    annotation.expectedCategories = ['tool', 'tool'];

    expect(() => GroundTruthAnnotationSchema.parse(annotation)).toThrow(
      'Duplicate expected failure category',
    );
  });

  it('rejects missing category evidence', () => {
    const annotation = validAnnotation();
    annotation.categoryEvidence = [];

    expect(() => GroundTruthAnnotationSchema.parse(annotation)).toThrow(
      'Missing evidence for category: tool',
    );
  });

  it('rejects evidence for an unlabelled category', () => {
    const annotation = validAnnotation();
    annotation.categoryEvidence.push({
      category: 'prompt',
      spanIds: ['1000000000000005'],
      justification: 'A prompt-related observation.',
    });

    expect(() => GroundTruthAnnotationSchema.parse(annotation)).toThrow(
      'Evidence category has no expected label',
    );
  });

  it('rejects duplicate evidence for a category', () => {
    const annotation = validAnnotation();
    annotation.categoryEvidence.push({
      ...annotation.categoryEvidence[0]!,
    });

    expect(() => GroundTruthAnnotationSchema.parse(annotation)).toThrow(
      'Duplicate category evidence',
    );
  });

  it('rejects malformed span IDs', () => {
    const annotation = validAnnotation();
    annotation.categoryEvidence[0]!.spanIds = ['invalid-span-id'];

    expect(GroundTruthAnnotationSchema.safeParse(annotation).success).toBe(false);
  });

  it('rejects duplicate evidence span IDs', () => {
    const annotation = validAnnotation();
    annotation.categoryEvidence[0]!.spanIds = [TOOL_SPAN, TOOL_SPAN];

    expect(() => GroundTruthAnnotationSchema.parse(annotation)).toThrow(
      'Duplicate evidence span ID',
    );
  });

  it('rejects duplicate causal assessments', () => {
    const annotation = validAnnotation();
    annotation.causalAssessments.push({
      ...annotation.causalAssessments[0]!,
    });

    expect(() => GroundTruthAnnotationSchema.parse(annotation)).toThrow(
      'Duplicate causal assessment',
    );
  });

  it('rejects a supported causal judgment without evidence', () => {
    const annotation = validAnnotation();
    annotation.causalAssessments[0] = {
      category: 'tool',
      judgment: 'supported',
      explanation: 'The tool failure contributed.',
      evidenceSpanIds: [],
    };

    expect(() => GroundTruthAnnotationSchema.parse(annotation)).toThrow(
      'Causal judgment requires supporting evidence',
    );
  });

  it('permits insufficient evidence without causal span IDs', () => {
    const annotation = validAnnotation();
    annotation.causalAssessments[0]!.evidenceSpanIds = [];

    expect(GroundTruthAnnotationSchema.safeParse(annotation).success).toBe(true);
  });

  it('rejects a path that escapes the dataset directory', () => {
    const annotation = validAnnotation();
    annotation.traceFile = '../outside.jsonl';

    expect(GroundTruthAnnotationSchema.safeParse(annotation).success).toBe(false);
  });

  it('rejects absolute and Windows-style paths', () => {
    for (const traceFile of ['/tmp/trace.jsonl', 'C:\\traces\\failure.jsonl']) {
      const annotation = {
        ...validAnnotation(),
        traceFile,
      };

      expect(GroundTruthAnnotationSchema.safeParse(annotation).success).toBe(false);
    }
  });

  it('rejects unsupported annotation status', () => {
    const annotation = {
      ...validAnnotation(),
      annotationStatus: 'approved',
    };

    expect(GroundTruthAnnotationSchema.safeParse(annotation).success).toBe(false);
  });

  it('rejects unknown dataset provenance', () => {
    const annotation = {
      ...validAnnotation(),
      datasetProvenance: 'unverified_external',
    };

    expect(GroundTruthAnnotationSchema.safeParse(annotation).success).toBe(false);
  });
});
