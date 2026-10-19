
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@soa/store';

import { evaluateTrace } from '../commands/evaluate-trace.js';

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

const fixture = readFileSync(
  new URL(
    '../../fixtures/tool-error.jsonl',
    import.meta.url,
  ),
  'utf8',
);

const outcomeInput: OutcomeEvidenceInput = {
  evidenceId: 'ev_test_outcome_001',
  runId: 'run_20261019T0900_baseline_01',
  taskId: 'django__django-11099',
  repo: 'django/django',
  baseCommit: 'abc123',
  // Test-only verified execution data.
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

describe('HEAE event publisher', () => {
  it('publishes valid outcome evidence', async () => {
    const store = new MemoryStore();
    const { attribution } = await evaluateTrace(fixture);

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

  it('does not append a duplicate outcome', async () => {
    const store = new MemoryStore();
    const { attribution } = await evaluateTrace(fixture);

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

  it('rejects conflicting outcome content', async () => {
    const store = new MemoryStore();
    const { attribution } = await evaluateTrace(fixture);

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
      await store.readJsonl(OUTCOME_EVENT_PATH),
    ).toHaveLength(1);
  });

  it('rejects a different evidence ID for the same execution', async () => {
    const store = new MemoryStore();
    const { attribution } = await evaluateTrace(fixture);

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
      await store.readJsonl(OUTCOME_EVENT_PATH),
    ).toHaveLength(1);
  });

  it('skips unreviewed memory evidence', async () => {
    const store = new MemoryStore();
    const { attribution } = await evaluateTrace(fixture);

    const result = await publishOutcomeEvidence(
      store,
      attribution,
      {
        ...outcomeInput,
        memoryUses: [
          {
            memory_id: 'mem_test_001',
            retrieved_span_id: '1000000000000001',
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
      await store.readJsonl(OUTCOME_EVENT_PATH),
    ).toHaveLength(0);
  });

  it('skips an unreviewed optimization proposal', async () => {
    const store = new MemoryStore();
    const { attribution } = await evaluateTrace(fixture);

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
      await store.readJsonl(OPTIMIZATION_EVENT_PATH),
    ).toHaveLength(0);
  });

  it('does not publish a signal without completed LLM judgment', async () => {
    const store = new MemoryStore();
    const { attribution } = await evaluateTrace(fixture);

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
      await store.readJsonl(OPTIMIZATION_EVENT_PATH),
    ).toHaveLength(0);
  });
});
