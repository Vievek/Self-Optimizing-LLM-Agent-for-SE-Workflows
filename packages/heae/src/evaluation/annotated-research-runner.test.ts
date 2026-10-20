
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import type { GroundTruthAnnotation } from './ground-truth-schema.js';

import {
  runAnnotatedResearchEvaluation,
} from './annotated-research-runner.js';

const toolFixture = new URL(
  '../../fixtures/tool-error.jsonl',
  import.meta.url,
);

const successFixture = new URL(
  '../../../../fixtures/traces/success.jsonl',
  import.meta.url,
);

const TOOL_SPAN = '1000000000000006';
const OUTPUT_SPAN = '1000000000000007';

let datasetDirectory: string;

function toolAnnotation(): GroundTruthAnnotation {
  return {
    caseId: 'tool-case-001',
    traceFile: 'tool-error.jsonl',
    observedOutcome: 'fail',
    expectedCategories: ['tool'],
    categoryEvidence: [{
      category: 'tool',
      spanIds: [TOOL_SPAN],
      justification:
        'The patch application returned a context mismatch.',
    }],
    causalAssessments: [{
      category: 'tool',
      judgment: 'insufficient_evidence',
      explanation:
        'The underlying reason for the mismatch is unknown.',
      evidenceSpanIds: [TOOL_SPAN, OUTPUT_SPAN],
    }],
    limitations: [
      'The generated patch is not included.',
    ],
    annotationStatus: 'reviewed',
    datasetProvenance: 'synthetic_development',
  };
}

function manifest(
  annotations: GroundTruthAnnotation[] = [
    toolAnnotation(),
  ],
) {
  return {
    datasetName: 'HEAE annotated fixture validation',
    datasetVersion: '1.0',
    annotations,
  };
}

beforeEach(async () => {
  datasetDirectory = await mkdtemp(
    path.join(tmpdir(), 'heae-annotated-'),
  );

  await copyFile(
    toolFixture,
    path.join(datasetDirectory, 'tool-error.jsonl'),
  );

  await copyFile(
    successFixture,
    path.join(datasetDirectory, 'success.jsonl'),
  );
});

afterEach(async () => {
  await rm(datasetDirectory, {
    recursive: true,
    force: true,
  });
});

describe('HEAE annotated research runner', () => {
  it('evaluates reviewed annotations with valid evidence', async () => {
    const report = await runAnnotatedResearchEvaluation(
      datasetDirectory,
      manifest(),
    );

    expect(report.metrics.totalCases).toBe(1);
    expect(report.metrics.exactMatches).toBe(1);
    expect(report.metrics.microF1).toBe(1);

    expect(report.annotationValidation.validatedCases)
      .toBe(1);

    expect(
      report.annotationValidation.allEvidenceReferencesValid,
    ).toBe(true);

    expect(
      report.annotationValidation.entries[0],
    ).toEqual({
      caseId: 'tool-case-001',
      traceFile: 'tool-error.jsonl',
      annotationStatus: 'reviewed',
      datasetProvenance: 'synthetic_development',
    });
  });

  it('rejects draft annotations', async () => {
    const annotation = toolAnnotation();
    annotation.annotationStatus = 'draft';

    await expect(
      runAnnotatedResearchEvaluation(
        datasetDirectory,
        manifest([annotation]),
      ),
    ).rejects.toThrow('draft annotation');
  });

  it('rejects nonexistent evidence spans', async () => {
    const annotation = toolAnnotation();

    annotation.categoryEvidence[0]!.spanIds = [
      'ffffffffffffffff',
    ];

    await expect(
      runAnnotatedResearchEvaluation(
        datasetDirectory,
        manifest([annotation]),
      ),
    ).rejects.toThrow(
      'MISSING_CATEGORY_EVIDENCE_SPAN',
    );
  });

  it('rejects an incorrect annotated outcome', async () => {
    const annotation = toolAnnotation();
    annotation.observedOutcome = 'pass';

    await expect(
      runAnnotatedResearchEvaluation(
        datasetDirectory,
        manifest([annotation]),
      ),
    ).rejects.toThrow('OUTCOME_MISMATCH');
  });

  it('rejects duplicate case IDs', async () => {
    const first = toolAnnotation();
    const second = toolAnnotation();

    await expect(
      runAnnotatedResearchEvaluation(
        datasetDirectory,
        manifest([first, second]),
      ),
    ).rejects.toThrow('Duplicate case ID');
  });

  it('rejects unsafe trace paths', async () => {
    const annotation = toolAnnotation();

    annotation.traceFile = '../outside.jsonl';

    await expect(
      runAnnotatedResearchEvaluation(
        datasetDirectory,
        manifest([annotation]),
      ),
    ).rejects.toThrow();
  });

  it('rejects nonexistent causal evidence spans', async () => {
    const annotation = toolAnnotation();

    annotation.causalAssessments[0]!.evidenceSpanIds = [
      'ffffffffffffffff',
    ];

    await expect(
      runAnnotatedResearchEvaluation(
        datasetDirectory,
        manifest([annotation]),
      ),
    ).rejects.toThrow(
      'MISSING_CAUSAL_EVIDENCE_SPAN',
    );
  });

  it('rejects invalid annotation categories', async () => {
    const annotation = {
      ...toolAnnotation(),
      expectedCategories: ['network'],
    };

    await expect(
      runAnnotatedResearchEvaluation(
        datasetDirectory,
        manifest([annotation as GroundTruthAnnotation]),
      ),
    ).rejects.toThrow();
  });
});
