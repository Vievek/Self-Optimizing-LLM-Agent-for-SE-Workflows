
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';
import type { GroundTruthAnnotation } from './ground-truth-schema.js';
import {
  validateAnnotationEvidence,
} from './annotation-evidence-validator.js';

const TOOL_SPAN = '1000000000000006';
const OUTPUT_SPAN = '1000000000000007';
const MISSING_SPAN = 'ffffffffffffffff';

const toolFixture = readFileSync(
  new URL('../../fixtures/tool-error.jsonl', import.meta.url),
  'utf8',
);

function toolGraph() {
  return buildTraceGraph(parseTraceJsonl(toolFixture));
}

function toolAnnotation(): GroundTruthAnnotation {
  return {
    caseId: 'tool-failure-001',
    traceFile: 'tool-error.jsonl',
    observedOutcome: 'fail',
    expectedCategories: ['tool'],
    categoryEvidence: [{
      category: 'tool',
      spanIds: [TOOL_SPAN],
      justification:
        'The apply_patch operation returned a context mismatch.',
    }],
    causalAssessments: [{
      category: 'tool',
      judgment: 'insufficient_evidence',
      explanation:
        'The underlying patch mismatch cause is not established.',
      evidenceSpanIds: [TOOL_SPAN, OUTPUT_SPAN],
    }],
    limitations: [
      'The patch content and repository state are unavailable.',
    ],
    annotationStatus: 'draft',
    datasetProvenance: 'synthetic_development',
  };
}

describe('HEAE annotation evidence validator', () => {
  it('accepts existing evidence and matching outcome', () => {
    const result = validateAnnotationEvidence(
      toolGraph(),
      toolAnnotation(),
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.actualOutcome).toBe('fail');
    expect(result.traceId).toBe(
      '0123456789abcdef0123456789abcdef',
    );
  });

  it('rejects a missing category evidence span', () => {
    const annotation = toolAnnotation();

    annotation.categoryEvidence[0]!.spanIds = [
      MISSING_SPAN,
    ];

    const result = validateAnnotationEvidence(
      toolGraph(),
      annotation,
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MISSING_CATEGORY_EVIDENCE_SPAN',
        }),
      ]),
    );
  });

  it('rejects a missing causal evidence span', () => {
    const annotation = toolAnnotation();

    annotation.causalAssessments[0]!.evidenceSpanIds = [
      MISSING_SPAN,
    ];

    const result = validateAnnotationEvidence(
      toolGraph(),
      annotation,
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MISSING_CAUSAL_EVIDENCE_SPAN',
        }),
      ]),
    );
  });

  it('rejects an annotated outcome that disagrees', () => {
    const annotation = toolAnnotation();

    annotation.observedOutcome = 'pass';

    const result = validateAnnotationEvidence(
      toolGraph(),
      annotation,
    );

    expect(result.valid).toBe(false);
    expect(result.actualOutcome).toBe('fail');
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OUTCOME_MISMATCH',
        }),
      ]),
    );
  });

  it('collects multiple independent validation issues', () => {
    const annotation = toolAnnotation();

    annotation.observedOutcome = 'pass';
    annotation.categoryEvidence[0]!.spanIds = [
      MISSING_SPAN,
    ];
    annotation.causalAssessments[0]!.evidenceSpanIds = [
      MISSING_SPAN,
    ];

    const result = validateAnnotationEvidence(
      toolGraph(),
      annotation,
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(3);
  });

  it('rejects structurally invalid annotations', () => {
    const annotation = toolAnnotation();

    annotation.expectedCategories = ['tool', 'tool'];

    expect(() =>
      validateAnnotationEvidence(
        toolGraph(),
        annotation,
      ),
    ).toThrow('Duplicate expected failure category');
  });

  it('treats a missing output span as unknown', () => {
    const graph = toolGraph();

    const graphWithoutOutput = {
      ...graph,
      nodes: graph.nodes.filter(
        (node) => node.span.name !== 'output',
      ),
    };

    const annotation = toolAnnotation();

    annotation.observedOutcome = 'unknown';
    annotation.causalAssessments[0]!.evidenceSpanIds = [
      TOOL_SPAN,
    ];

    const result = validateAnnotationEvidence(
      graphWithoutOutput,
      annotation,
    );

    expect(result.valid).toBe(true);
    expect(result.actualOutcome).toBe('unknown');
  });

  it('reports an unknown outcome mismatch', () => {
    const graph = toolGraph();

    const graphWithoutOutput = {
      ...graph,
      nodes: graph.nodes.filter(
        (node) => node.span.name !== 'output',
      ),
    };

    const annotation = toolAnnotation();

    annotation.causalAssessments[0]!.evidenceSpanIds = [
      TOOL_SPAN,
    ];

    const result = validateAnnotationEvidence(
      graphWithoutOutput,
      annotation,
    );

    expect(result.valid).toBe(false);
    expect(result.actualOutcome).toBe('unknown');
    expect(result.issues[0]?.code).toBe('OUTCOME_MISMATCH');
  });
});
