import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { OutcomeEvidenceSchema } from '@soa/contracts';

import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';
import { attributeTrace } from '../attribution/evidence-attribution.js';

import type { HybridAttributionResult } from '../attribution/hybrid-attribution.js';

import {
  generateOutcomeEvidence,
  type OutcomeEvidenceInput,
} from './outcome-evidence-generator.js';

const toolPath = new URL('../../fixtures/tool-error.jsonl', import.meta.url);

function makeAttribution(): HybridAttributionResult {
  const graph = buildTraceGraph(parseTraceJsonl(readFileSync(toolPath, 'utf8')));

  const ruleReport = attributeTrace(graph);

  const hypothesis = ruleReport.hypotheses.find((item) => item.category === 'tool');

  if (!hypothesis) {
    throw new Error('Expected tool hypothesis');
  }

  return {
    traceId: ruleReport.traceId,
    ruleReport,
    judgeStatus: 'completed',
    judgment: {
      findings: [
        {
          category: 'tool',
          assessment: 'supported',
          explanation: 'Trace observations support this hypothesis.',
          evidenceNodeIds: [...hypothesis.evidenceNodeIds],
          limitations: ['Root causality is not independently verified.'],
        },
      ],
      overallUncertainty: 'Additional execution evidence may be required.',
    },
    warnings: [...ruleReport.warnings],
  };
}

function makeInput(): OutcomeEvidenceInput {
  return {
    evidenceId: 'ev_test_001',
    runId: 'run_test',
    taskId: 'task_test',
    repo: 'example/repository',
    baseCommit: 'abc123def456',
    outcome: {
      resolved: false,
      tests_passed: 3,
      tests_failed: 1,
      patch_applied: true,
    },
    cost: {
      tokens_in: 1200,
      tokens_out: 300,
      wall_ms: 4500,
    },
  };
}

describe('HEAE Outcome Evidence v2.0 generator', () => {
  it('generates schema-valid execution evidence', () => {
    const attribution = makeAttribution();

    const result = generateOutcomeEvidence(attribution, makeInput());

    expect(result.status).toBe('generated');

    if (result.status !== 'generated') {
      throw new Error(result.reason);
    }

    expect(OutcomeEvidenceSchema.safeParse(result.evidence).success).toBe(true);

    expect(result.evidence.schema_version).toBe('2.0');
    expect(result.evidence.trace_id).toBe(attribution.traceId);
  });

  it('defaults unknown memory uses and labels to empty', () => {
    const result = generateOutcomeEvidence(makeAttribution(), makeInput());

    if (result.status !== 'generated') {
      throw new Error(result.reason);
    }

    expect(result.evidence.memory_uses).toEqual([]);
    expect(result.evidence.failure_labels).toEqual([]);
  });

  it('accepts a supported failure label', () => {
    const attribution = makeAttribution();
    const input = makeInput();

    const hypothesis = attribution.ruleReport.hypotheses.find((item) => item.category === 'tool');

    if (!hypothesis) {
      throw new Error('Expected tool hypothesis');
    }

    input.failureLabels = [
      {
        class: 'tool',
        node_ids: [...hypothesis.evidenceNodeIds],
        confidence: 0.8,
      },
    ];

    const result = generateOutcomeEvidence(attribution, input);

    expect(result.status).toBe('generated');

    if (result.status !== 'generated') {
      throw new Error(result.reason);
    }

    expect(result.evidence.failure_labels[0]?.class).toBe('tool');
  });

  it('rejects invented failure evidence nodes', () => {
    const input = makeInput();

    input.failureLabels = [
      {
        class: 'tool',
        node_ids: ['ffffffffffffffff'],
        confidence: 0.8,
      },
    ];

    const result = generateOutcomeEvidence(makeAttribution(), input);

    expect(result.status).toBe('skipped');
  });

  it('rejects unsupported failure assessments', () => {
    const attribution = makeAttribution();
    const input = makeInput();

    const finding = attribution.judgment?.findings[0];

    if (!finding) {
      throw new Error('Expected finding');
    }

    finding.assessment = 'insufficient_evidence';

    input.failureLabels = [
      {
        class: 'tool',
        node_ids: [...finding.evidenceNodeIds],
        confidence: 0.8,
      },
    ];

    const result = generateOutcomeEvidence(attribution, input);

    expect(result.status).toBe('skipped');
  });

  it('rejects invalid execution costs', () => {
    const input = makeInput();

    input.cost.tokens_in = -1;

    const result = generateOutcomeEvidence(makeAttribution(), input);

    expect(result.status).toBe('skipped');
  });

  it('rejects unreviewed memory uses', () => {
    const input = makeInput();

    input.memoryUses = [
      {
        memory_id: 'mem_test_001',
        retrieved_span_id: '1000000000000003',
        cited_by_node_ids: [],
        implicated_in_failure: false,
      },
    ];

    const result = generateOutcomeEvidence(makeAttribution(), input);

    expect(result.status).toBe('skipped');
  });

  it('rejects out-of-range failure confidence', () => {
    const attribution = makeAttribution();
    const input = makeInput();

    const hypothesis = attribution.ruleReport.hypotheses.find((item) => item.category === 'tool');

    if (!hypothesis) {
      throw new Error('Expected tool hypothesis');
    }

    input.failureLabels = [
      {
        class: 'tool',
        node_ids: [...hypothesis.evidenceNodeIds],
        confidence: 1.5,
      },
    ];

    const result = generateOutcomeEvidence(attribution, input);

    expect(result.status).toBe('skipped');
  });
});
