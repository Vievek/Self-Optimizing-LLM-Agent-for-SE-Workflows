import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import type { ChatResponse, LlmProvider } from '@soa/llm';
import { OptimizationSignalSchema } from '@soa/contracts';
import { MemoryStore } from '@soa/store';

import type { HybridAttributionResult } from '../attribution/hybrid-attribution.js';

import { attributeTrace } from '../attribution/evidence-attribution.js';
import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';

import { EvaluationHistory } from '../persistence/evaluation-history.js';

import type { OutcomeEvidenceInput } from '../evidence/outcome-evidence-generator.js';

import type { ReviewedOptimizationProposal } from '../signals/optimization-signal-generator.js';

import { OUTCOME_EVENT_PATH, OPTIMIZATION_EVENT_PATH } from '../events/heae-event-publisher.js';

import { publishEvaluationEvents } from './publish-evaluation-events.js';
import { evaluateTrace } from './evaluate-trace.js';

const fixture = readFileSync(new URL('../../fixtures/tool-error.jsonl', import.meta.url), 'utf8');

const runId = 'run_20261019T0900_baseline_01';
const taskId = 'django__django-11099';

const outcomeInput: OutcomeEvidenceInput = {
  evidenceId: 'ev_saved_eval_001',
  runId,
  taskId,
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

const proposal: ReviewedOptimizationProposal = {
  reviewed: true,
  signalId: 'sig_saved_eval_001',
  groupId: 'grp_saved_eval',
  runId,
  taskId,
  failureClass: 'tool',
  rootCauseSummary: 'Reviewed tool-operation failure hypothesis.',
  evidenceNodeIds: ['1000000000000006'],
  targetAxis: 'tool',
  configPath: 'config/tools.yaml',
  affectedSubtask: 'tool_execution',
  suggestedAction: 'tool_description_refine',
  confidence: 0.8,
  configVersionAtFailure: 'cfg_0001',
};

/**
 * Create test-only attribution data with a simulated
 * supported judge finding.
 */
function makeAttribution(supported: boolean): HybridAttributionResult {
  const graph = buildTraceGraph(parseTraceJsonl(fixture));

  const ruleReport = attributeTrace(graph);

  const hypothesis = ruleReport.hypotheses.find((item) => item.category === 'tool');

  if (!hypothesis) {
    throw new Error('Expected tool hypothesis');
  }

  if (!supported) {
    return {
      traceId: ruleReport.traceId,
      ruleReport,
      judgeStatus: 'unavailable',
      judgment: null,
      warnings: ['LLM judge unavailable in test.'],
    };
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
          explanation: 'The tool hypothesis is supported by trace evidence.',
          evidenceNodeIds: [...hypothesis.evidenceNodeIds],
          limitations: ['A supported hypothesis does not prove causality.'],
        },
      ],
      overallUncertainty: 'The precise underlying cause remains uncertain.',
    },
    warnings: [...ruleReport.warnings],
  };
}

async function saveEvaluation(store: MemoryStore, supported = true): Promise<string> {
  const attribution = makeAttribution(supported);

  await new EvaluationHistory(store).save(attribution);

  return attribution.traceId;
}

describe('HEAE saved-evaluation event publication', () => {
  it('evaluates through the simulated judge interface and publishes a validated signal', async () => {
    const store = new MemoryStore();
    const provider: LlmProvider = {
      async chat(request): Promise<ChatResponse> {
        return {
          content: JSON.stringify({
            findings: [
              {
                category: 'tool',
                assessment: 'supported',
                explanation: 'The recorded tool failure is supported by the trace evidence.',
                evidenceNodeIds: ['1000000000000006'],
                limitations: [
                  'This controlled provider does not establish causality beyond the trace.',
                ],
              },
            ],
            overallUncertainty: 'This is a controlled simulated-judge integration scenario.',
          }),
          tokensIn: 0,
          tokensOut: 0,
          model: request.model,
          provider: 'simulated-test-provider',
        };
      },
      async embed(): Promise<number[][]> {
        return [];
      },
    };

    const evaluated = await evaluateTrace(fixture, {
      store,
      provider,
      model: 'simulated-test-judge',
      judgeProvenance: {
        mode: 'simulated',
        provider: 'simulated-test-provider',
        model: 'simulated-test-judge',
      },
    });

    expect(evaluated.summary.judgeStatus).toBe('completed');
    expect(evaluated.attribution.judgeProvenance?.mode).toBe('simulated');

    const saved = await new EvaluationHistory(store).load(evaluated.summary.traceId);
    expect(saved?.traceId).toBe(evaluated.summary.traceId);
    expect(saved?.result.judgeProvenance?.mode).toBe('simulated');

    const scenarioProposal = {
      ...proposal,
      runId: 'run_20261012T0900_memory_full_01',
    };

    const result = await publishEvaluationEvents(evaluated.summary.traceId, {
      store,
      optimizationProposal: scenarioProposal,
    });

    expect(result.optimization?.status).toBe('published');
    expect(result.optimization?.event?.trace_id).toBe(evaluated.summary.traceId);

    const signal = result.optimization?.event;
    expect(signal).toBeDefined();
    expect(OptimizationSignalSchema.safeParse(signal).success).toBe(true);
    expect(signal).toMatchObject({
      signal_id: scenarioProposal.signalId,
      trace_id: saved?.traceId,
      failure_class: 'tool',
      target: { axis: 'tool', config_path: 'config/tools.yaml' },
      suggested_action: 'tool_description_refine',
      classifier: 'llm_judge',
      config_version_at_failure: 'cfg_0001',
    });
    expect(signal?.root_cause.evidence_node_ids).toEqual(['1000000000000006']);

    const retry = await publishEvaluationEvents(evaluated.summary.traceId, {
      store,
      optimizationProposal: scenarioProposal,
    });
    expect(retry.optimization?.status).toBe('already_exists');
    expect(await store.readJsonl(OPTIMIZATION_EVENT_PATH)).toHaveLength(1);
  });

  it('publishes both events from a saved evaluation', async () => {
    const store = new MemoryStore();
    const traceId = await saveEvaluation(store);

    const result = await publishEvaluationEvents(traceId, {
      store,
      outcomeInput,
      optimizationProposal: proposal,
    });

    expect(result.traceId).toBe(traceId);
    expect(result.outcome?.status).toBe('published');
    expect(result.optimization?.status).toBe('published');

    expect(await store.readJsonl(OUTCOME_EVENT_PATH)).toHaveLength(1);

    expect(await store.readJsonl(OPTIMIZATION_EVENT_PATH)).toHaveLength(1);
  });

  it('does not duplicate events on retry', async () => {
    const store = new MemoryStore();
    const traceId = await saveEvaluation(store);

    const options = {
      store,
      outcomeInput,
      optimizationProposal: proposal,
    };

    await publishEvaluationEvents(traceId, options);

    const retry = await publishEvaluationEvents(traceId, options);

    expect(retry.outcome?.status).toBe('already_exists');

    expect(retry.optimization?.status).toBe('already_exists');

    expect(await store.readJsonl(OUTCOME_EVENT_PATH)).toHaveLength(1);

    expect(await store.readJsonl(OPTIMIZATION_EVENT_PATH)).toHaveLength(1);
  });

  it('publishes only the requested outcome event', async () => {
    const store = new MemoryStore();
    const traceId = await saveEvaluation(store);

    const result = await publishEvaluationEvents(traceId, {
      store,
      outcomeInput,
    });

    expect(result.outcome?.status).toBe('published');
    expect(result.optimization).toBeNull();

    expect(await store.readJsonl(OPTIMIZATION_EVENT_PATH)).toHaveLength(0);
  });

  it('rejects a missing saved evaluation', async () => {
    const store = new MemoryStore();

    await expect(
      publishEvaluationEvents('0123456789abcdef0123456789abcdef', {
        store,
        outcomeInput,
      }),
    ).rejects.toThrow('Saved HEAE evaluation not found');

    expect(await store.readJsonl(OUTCOME_EVENT_PATH)).toHaveLength(0);
  });

  it('requires at least one publication input', async () => {
    const store = new MemoryStore();
    const traceId = await saveEvaluation(store);

    await expect(
      publishEvaluationEvents(traceId, {
        store,
      }),
    ).rejects.toThrow('At least one event publication input is required');
  });

  it('rejects mismatched execution identities before writing', async () => {
    const store = new MemoryStore();
    const traceId = await saveEvaluation(store);

    await expect(
      publishEvaluationEvents(traceId, {
        store,
        outcomeInput,
        optimizationProposal: {
          ...proposal,
          taskId: 'another-task',
        },
      }),
    ).rejects.toThrow('Publication identity mismatch');

    expect(await store.readJsonl(OUTCOME_EVENT_PATH)).toHaveLength(0);

    expect(await store.readJsonl(OPTIMIZATION_EVENT_PATH)).toHaveLength(0);
  });

  it('skips a signal without supported judgment', async () => {
    const store = new MemoryStore();

    const traceId = await saveEvaluation(store, false);

    const result = await publishEvaluationEvents(traceId, {
      store,
      optimizationProposal: proposal,
    });

    expect(result.outcome).toBeNull();

    expect(result.optimization?.status).toBe('skipped');

    expect(await store.readJsonl(OPTIMIZATION_EVENT_PATH)).toHaveLength(0);
  });

  it('preserves saved evaluation history', async () => {
    const store = new MemoryStore();
    const traceId = await saveEvaluation(store);

    const history = new EvaluationHistory(store);
    const before = await history.load(traceId);

    await publishEvaluationEvents(traceId, {
      store,
      outcomeInput,
      optimizationProposal: proposal,
    });

    const after = await history.load(traceId);

    expect(after).toEqual(before);
  });

  it('can publish a previously missing signal on retry', async () => {
    const store = new MemoryStore();
    const traceId = await saveEvaluation(store);

    const first = await publishEvaluationEvents(traceId, {
      store,
      outcomeInput,
    });

    expect(first.outcome?.status).toBe('published');

    const second = await publishEvaluationEvents(traceId, {
      store,
      outcomeInput,
      optimizationProposal: proposal,
    });

    expect(second.outcome?.status).toBe('already_exists');

    expect(second.optimization?.status).toBe('published');

    expect(await store.readJsonl(OUTCOME_EVENT_PATH)).toHaveLength(1);

    expect(await store.readJsonl(OPTIMIZATION_EVENT_PATH)).toHaveLength(1);
  });
});
