
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OptimizationSignalSchema } from '@soa/contracts';

import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';
import { attributeTrace } from '../attribution/evidence-attribution.js';

import type {
  HybridAttributionResult,
} from '../attribution/hybrid-attribution.js';

import {
  generateOptimizationSignal,
  type ReviewedOptimizationProposal,
} from './optimization-signal-generator.js';

const toolPath = new URL(
  '../../fixtures/tool-error.jsonl',
  import.meta.url,
);

function makeAttribution(): HybridAttributionResult {
  const graph = buildTraceGraph(
    parseTraceJsonl(readFileSync(toolPath, 'utf8')),
  );

  const ruleReport = attributeTrace(graph);

  const hypothesis = ruleReport.hypotheses.find(
    (item) => item.category === 'tool',
  );

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
          explanation: 'Tool failure is supported by trace evidence.',
          evidenceNodeIds: [...hypothesis.evidenceNodeIds],
          limitations: [
            'This does not independently prove root causality.',
          ],
        },
      ],
      overallUncertainty:
        'The precise cause requires additional investigation.',
    },
    warnings: [...ruleReport.warnings],
  };
}

function makeProposal(
  attribution: HybridAttributionResult,
): ReviewedOptimizationProposal {
  const hypothesis = attribution.ruleReport.hypotheses.find(
    (item) => item.category === 'tool',
  );

  if (!hypothesis) {
    throw new Error('Expected tool hypothesis');
  }

  return {
    reviewed: true,
    signalId: 'sig_test_tool_01',
    groupId: 'grp_test',
    runId: 'run_test',
    taskId: 'task_test',
    failureClass: 'tool',
    rootCauseSummary:
      'Reviewed hypothesis: the tool operation failed during execution.',
    evidenceNodeIds: [...hypothesis.evidenceNodeIds],
    targetAxis: 'tool',
    configPath: 'tools.execution',
    affectedSubtask: 'tool_execution',
    suggestedAction: 'tool_description_refine',
    confidence: 0.8,
    configVersionAtFailure: 'cfg_test_01',
  };
}

describe('HEAE Optimization Signal v2.0 generator', () => {
  it('generates a valid signal', () => {
    const attribution = makeAttribution();
    const result = generateOptimizationSignal(
      attribution,
      makeProposal(attribution),
    );

    expect(result.status).toBe('generated');

    if (result.status !== 'generated') {
      throw new Error(result.reason);
    }

    expect(
      OptimizationSignalSchema.safeParse(result.signal).success,
    ).toBe(true);

    expect(result.signal.schema_version).toBe('2.0');
    expect(result.signal.classifier).toBe('llm_judge');
  });

  it('rejects an unreviewed proposal', () => {
    const attribution = makeAttribution();
    const proposal = makeProposal(attribution);
    proposal.reviewed = false;

    expect(
      generateOptimizationSignal(attribution, proposal).status,
    ).toBe('skipped');
  });

  it('rejects unavailable judge results', () => {
    const attribution = makeAttribution();
    const proposal = makeProposal(attribution);
    attribution.judgeStatus = 'unavailable';
    attribution.judgment = null;

    expect(
      generateOptimizationSignal(attribution, proposal).status,
    ).toBe('skipped');
  });

  it('rejects insufficient evidence', () => {
    const attribution = makeAttribution();
    const proposal = makeProposal(attribution);

    const finding = attribution.judgment?.findings[0];
    if (!finding) throw new Error('Expected model finding');

    finding.assessment = 'insufficient_evidence';

    expect(
      generateOptimizationSignal(attribution, proposal).status,
    ).toBe('skipped');
  });

  it('rejects invented evidence IDs', () => {
    const attribution = makeAttribution();
    const proposal = makeProposal(attribution);
    proposal.evidenceNodeIds = ['ffffffffffffffff'];

    expect(
      generateOptimizationSignal(attribution, proposal).status,
    ).toBe('skipped');
  });

  it('rejects invalid confidence estimates', () => {
    const attribution = makeAttribution();
    const proposal = makeProposal(attribution);
    proposal.confidence = 1.5;

    expect(
      generateOptimizationSignal(attribution, proposal).status,
    ).toBe('skipped');
  });

  it('rejects unsupported failure classes', () => {
    const attribution = makeAttribution();
    const proposal = makeProposal(attribution);
    proposal.failureClass = 'retrieval';

    expect(
      generateOptimizationSignal(attribution, proposal).status,
    ).toBe('skipped');
  });
});
