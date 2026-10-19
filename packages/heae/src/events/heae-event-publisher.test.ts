
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@soa/store';
import { OptimizationSignalSchema } from '@soa/contracts';

import { evaluateTrace } from '../commands/evaluate-trace.js';
import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';
import { attributeTrace } from '../attribution/evidence-attribution.js';

import type {
  HybridAttributionResult,
} from '../attribution/hybrid-attribution.js';

import type {
  OutcomeEvidenceInput,
} from '../evidence/outcome-evidence-generator.js';

import type {
  ReviewedOptimizationProposal,
} from '../signals/optimization-signal-generator.js';

import {
  OUTCOME_EVENT_PATH,
  OPTIMIZATION_EVENT_PATH,
  publishOutcomeEvidence,
  publishOptimizationSignal,
} from './heae-event-publisher.js';

/**
 * Synthetic tool-error execution trace.
 */
const fixture = readFileSync(
  new URL(
    '../../fixtures/tool-error.jsonl',
    import.meta.url,
  ),
  'utf8',
);

/**
 * Test-only externally verified execution information.
 */
const outcomeInput: OutcomeEvidenceInput = {
  evidenceId: 'ev_test_outcome_001',
  runId: 'run_20261019T0900_baseline_01',
  taskId: 'django__django-11099',
  repo: 'django/django',
  baseCommit: 'abc123',

  outcome: {
    resolved: false,
    tests_passed: 2,
    tests_failed: 1,
    patch_applied: false,
  },

  cost: {
    tokens_in: 100,
    tokens_out: 40,
    wall_ms: 1400,
  },
};

/**
 * Test-only reviewed optimization proposal.
 */
const reviewedProposal: ReviewedOptimizationProposal = {
  reviewed: true,
  signalId: 'sig_test_001',
  groupId: 'group_test_001',
  runId: outcomeInput.runId,
  taskId: outcomeInput.taskId,
  failureClass: 'tool',

  rootCauseSummary:
    'Reviewed tool failure requiring further correction.',

  evidenceNodeIds: ['1000000000000006'],

  targetAxis: 'tool',
  configPath: 'config/tools.yaml',
  affectedSubtask: outcomeInput.taskId,
  suggestedAction: 'tool_description_refine',
  confidence: 0.8,
  configVersionAtFailure: 'cfg_0001',
};

/**
 * Create a schema-compatible, simulated supported
 * LLM judgment for testing positive signal publication.
 *
 * This is a controlled test double, not a real
 * model assessment or proof of root causality.
 */
function makeSupportedAttribution(): HybridAttributionResult {
  const graph = buildTraceGraph(
    parseTraceJsonl(fixture),
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
          explanation:
            'Tool failure is supported by trace evidence.',
          evidenceNodeIds: [
            ...hypothesis.evidenceNodeIds,
          ],
          limitations: [
            'The exact root cause still requires independent review.',
          ],
        },
      ],

      overallUncertainty:
        'The evidence supports the hypothesis but does not prove causality.',
    },

    warnings: [...ruleReport.warnings],
  };
}

describe('HEAE event publisher', () => {
  /**
   * TEST 1:
   * Publish valid OutcomeEvidence.
   */
  it('publishes valid outcome evidence', async () => {
    const store = new MemoryStore();

    const { attribution } = await evaluateTrace(
      fixture,
    );

    const result = await publishOutcomeEvidence(
      store,
      attribution,
      outcomeInput,
    );

    expect(result.status).toBe('published');
    expect(result.event?.evidence_id).toBe(
      outcomeInput.evidenceId,
    );

    const records = await store.readJsonl(
      OUTCOME_EVENT_PATH,
    );

    expect(records).toHaveLength(1);
  });

  /**
   * TEST 2:
   * Do not append duplicate OutcomeEvidence.
   */
  it('does not append a duplicate outcome', async () => {
    const store = new MemoryStore();

    const { attribution } = await evaluateTrace(
      fixture,
    );

    await publishOutcomeEvidence(
      store,
      attribution,
      outcomeInput,
    );

    const retry = await publishOutcomeEvidence(
      store,
      attribution,
      outcomeInput,
    );

    expect(retry.status).toBe('already_exists');

    const records = await store.readJsonl(
      OUTCOME_EVENT_PATH,
    );

    expect(records).toHaveLength(1);
  });

  /**
   * TEST 3:
   * Reject an OutcomeEvidence ID whose content changes.
   */
  it('rejects conflicting outcome content', async () => {
    const store = new MemoryStore();

    const { attribution } = await evaluateTrace(
      fixture,
    );

    await publishOutcomeEvidence(
      store,
      attribution,
      outcomeInput,
    );

    await expect(
      publishOutcomeEvidence(
        store,
        attribution,
        {
          ...outcomeInput,
          outcome: {
            ...outcomeInput.outcome,
            tests_failed: 3,
          },
        },
      ),
    ).rejects.toThrow(
      'OutcomeEvidence publication conflict',
    );

    expect(
      await store.readJsonl(
        OUTCOME_EVENT_PATH,
      ),
    ).toHaveLength(1);
  });

  /**
   * TEST 4:
   * Reject a different evidence ID for the same
   * run, task and trace.
   */
  it('rejects a different evidence ID for the same execution', async () => {
    const store = new MemoryStore();

    const { attribution } = await evaluateTrace(
      fixture,
    );

    await publishOutcomeEvidence(
      store,
      attribution,
      outcomeInput,
    );

    await expect(
      publishOutcomeEvidence(
        store,
        attribution,
        {
          ...outcomeInput,
          evidenceId: 'ev_test_outcome_002',
        },
      ),
    ).rejects.toThrow(
      'OutcomeEvidence publication conflict',
    );

    expect(
      await store.readJsonl(
        OUTCOME_EVENT_PATH,
      ),
    ).toHaveLength(1);
  });

  /**
   * TEST 5:
   * Unreviewed memory information must not be
   * published as verified evidence.
   */
  it('skips unreviewed memory evidence', async () => {
    const store = new MemoryStore();

    const { attribution } = await evaluateTrace(
      fixture,
    );

    const result = await publishOutcomeEvidence(
      store,
      attribution,
      {
        ...outcomeInput,

        memoryUses: [
          {
            memory_id: 'mem_test_001',
            retrieved_span_id:
              '1000000000000001',
            cited_by_node_ids: [],
            implicated_in_failure: false,
          },
        ],

        memoryUsesReviewed: false,
      },
    );

    expect(result.status).toBe('skipped');

    expect(result.reason).toContain(
      'external review',
    );

    expect(
      await store.readJsonl(
        OUTCOME_EVENT_PATH,
      ),
    ).toHaveLength(0);
  });

  /**
   * TEST 6:
   * Unreviewed optimization proposals are skipped.
   */
  it('skips an unreviewed optimization proposal', async () => {
    const store = new MemoryStore();

    const { attribution } = await evaluateTrace(
      fixture,
    );

    const result = await publishOptimizationSignal(
      store,
      attribution,
      {
        ...reviewedProposal,
        reviewed: false,
      },
    );

    expect(result.status).toBe('skipped');

    expect(
      await store.readJsonl(
        OPTIMIZATION_EVENT_PATH,
      ),
    ).toHaveLength(0);
  });

  /**
   * TEST 7:
   * A real signal cannot be generated without a
   * completed LLM judgment.
   */
  it('does not publish a signal without completed LLM judgment', async () => {
    const store = new MemoryStore();

    const { attribution } = await evaluateTrace(
      fixture,
    );

    const result = await publishOptimizationSignal(
      store,
      attribution,
      reviewedProposal,
    );

    expect(result.status).toBe('skipped');

    expect(result.reason).toContain(
      'LLM judgment is unavailable',
    );

    expect(
      await store.readJsonl(
        OPTIMIZATION_EVENT_PATH,
      ),
    ).toHaveLength(0);
  });

  /**
   * TEST 8:
   * Publish a reviewed optimization signal when
   * the simulated judge supports the hypothesis.
   */
  it('publishes a supported optimization signal', async () => {
    const store = new MemoryStore();

    const attribution =
      makeSupportedAttribution();

    const result = await publishOptimizationSignal(
      store,
      attribution,
      reviewedProposal,
    );

    expect(result.status).toBe('published');

    expect(result.event?.signal_id).toBe(
      reviewedProposal.signalId,
    );

    expect(result.event?.classifier).toBe(
      'llm_judge',
    );

    expect(
      OptimizationSignalSchema.safeParse(
        result.event,
      ).success,
    ).toBe(true);

    const saved = await store.readJsonl(
      OPTIMIZATION_EVENT_PATH,
    );

    expect(saved).toHaveLength(1);

    expect(saved[0]).toEqual(result.event);
  });

  /**
   * TEST 9:
   * Publishing the same signal again must not
   * append a duplicate JSONL record.
   */
  it('does not append a duplicate optimization signal', async () => {
    const store = new MemoryStore();

    const attribution =
      makeSupportedAttribution();

    const first = await publishOptimizationSignal(
      store,
      attribution,
      reviewedProposal,
    );

    expect(first.status).toBe('published');

    const retry = await publishOptimizationSignal(
      store,
      attribution,
      reviewedProposal,
    );

    expect(retry.status).toBe(
      'already_exists',
    );

    expect(retry.event).toEqual(first.event);

    const saved = await store.readJsonl(
      OPTIMIZATION_EVENT_PATH,
    );

    expect(saved).toHaveLength(1);
  });

  /**
   * TEST 10:
   * A signal ID cannot be reused for
   * conflicting optimization content.
   */
  it('rejects conflicting optimization signal content', async () => {
    const store = new MemoryStore();

    const attribution =
      makeSupportedAttribution();

    await publishOptimizationSignal(
      store,
      attribution,
      reviewedProposal,
    );

    await expect(
      publishOptimizationSignal(
        store,
        attribution,
        {
          ...reviewedProposal,
          rootCauseSummary:
            'Different reviewed explanation.',
        },
      ),
    ).rejects.toThrow(
      'OptimizationSignal publication conflict',
    );

    const saved = await store.readJsonl(
      OPTIMIZATION_EVENT_PATH,
    );

    expect(saved).toHaveLength(1);
  });
});
