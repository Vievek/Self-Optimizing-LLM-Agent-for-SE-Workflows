import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OptimizationSignalSchema, type FailureClass, type SuggestedAction } from '@soa/contracts';
import type { ChatResponse, LlmProvider } from '@soa/llm';
import { FileStore } from '@soa/store';

import { readTraceFile } from '../trace-intake.js';
import { evaluateTrace } from './evaluate-trace.js';
import { OPTIMIZATION_EVENT_PATH } from '../events/heae-event-publisher.js';
import { publishEvaluationEvents } from './publish-evaluation-events.js';
import { EvaluationHistory } from '../persistence/evaluation-history.js';
import { KuzuInteractionStore } from '../persistence/kuzu-interaction-store.js';
import type { ReviewedOptimizationProposal } from '../signals/optimization-signal-generator.js';

const TRACE_FIXTURE = new URL('../../fixtures/tool-error.jsonl', import.meta.url);

const CONFIGURATION_BY_CLASS: Record<FailureClass, { path: string; action: SuggestedAction }> = {
  prompt: { path: 'config/prompts.yaml', action: 'prompt_rewrite' },
  tool: { path: 'config/tools.yaml', action: 'tool_description_refine' },
  retrieval: { path: 'config/retrieval.yaml', action: 'retrieval_param_update' },
  planning: { path: 'config/planning.yaml', action: 'planning_param_update' },
  workflow: { path: 'config/workflow.yaml', action: 'workflow_param_update' },
};

interface JudgeEvidence {
  hypotheses: Array<{
    category: FailureClass;
    evidenceNodeIds: string[];
  }>;
}

/**
 * Run an explicitly controlled positive publication scenario.
 *
 * This is intentionally not part of normal evaluation. It creates a fresh
 * trace identity, uses the real rule engine and judge interface, marks the
 * provider as simulated, and persists only through HEAE's normal stores.
 */
export async function runControlledSignalIntegration(): Promise<{
  traceId: string;
  signalId: string;
  publicationStatus: 'published';
  evaluationPath: string;
  signalPath: string;
  judgeProvenance: {
    mode: 'simulated';
    provider: 'simulated-test-provider';
    model: 'controlled-simulated-judge';
  };
}> {
  const traceId = randomBytes(16).toString('hex');
  const runId = `run_${traceId.slice(0, 16)}_controlled_signal`;
  const taskId = 'controlled-heae-signal-publication';
  const spans = await readTraceFile(fileURLToPath(TRACE_FIXTURE));
  const jsonlContent = spans
    .map((span) =>
      JSON.stringify({
        ...span,
        trace_id: traceId,
        attributes:
          span.name === 'task'
            ? {
                ...span.attributes,
                run_id: runId,
                task_id: taskId,
                config_version: 'cfg_controlled_signal',
              }
            : span.attributes,
      }),
    )
    .join('\n');

  const provider: LlmProvider = {
    async chat(request): Promise<ChatResponse> {
      const userMessage = request.messages.find((message) => message.role === 'user');
      const evidence = JSON.parse(userMessage?.content ?? '{}') as JudgeEvidence;
      const hypothesis = evidence.hypotheses.find((item) => item.category === 'tool');

      if (!hypothesis) {
        throw new Error('Controlled signal scenario requires a tool hypothesis.');
      }

      return {
        content: JSON.stringify({
          findings: [
            {
              category: hypothesis.category,
              assessment: 'supported',
              explanation: 'Controlled simulated judgment supports the rule hypothesis.',
              evidenceNodeIds: hypothesis.evidenceNodeIds,
              limitations: ['This result is simulated for an integration demonstration.'],
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

  const store = new FileStore('.heae/history');
  const graphStore = await KuzuInteractionStore.open('store/graphs/heae.kuzu');

  try {
    const evaluated = await evaluateTrace(jsonlContent, {
      store,
      graphStore,
      provider,
      model: 'controlled-simulated-judge',
      judgeProvenance: {
        mode: 'simulated',
        provider: 'simulated-test-provider',
        model: 'controlled-simulated-judge',
      },
    });

    const hypothesis = evaluated.attribution.ruleReport.hypotheses.find(
      (item) => item.category === 'tool',
    );

    if (!hypothesis) {
      throw new Error('Controlled signal scenario produced no tool hypothesis.');
    }

    const target = CONFIGURATION_BY_CLASS[hypothesis.category];
    const proposal: ReviewedOptimizationProposal = {
      reviewed: true,
      signalId: `sig_controlled_${traceId}`,
      groupId: `group_controlled_${traceId.slice(0, 16)}`,
      runId,
      taskId,
      failureClass: hypothesis.category,
      rootCauseSummary: 'Controlled reviewed proposal for the recorded tool failure.',
      evidenceNodeIds: [...hypothesis.evidenceNodeIds],
      targetAxis: hypothesis.category,
      configPath: target.path,
      affectedSubtask: taskId,
      suggestedAction: target.action,
      confidence: 0.8,
      configVersionAtFailure: 'cfg_controlled_signal',
    };

    const publication = await publishEvaluationEvents(evaluated.summary.traceId, {
      store,
      optimizationProposal: proposal,
    });

    if (publication.optimization?.status !== 'published' || !publication.optimization.event) {
      throw new Error(
        `Controlled OptimizationSignal publication did not succeed: ${publication.optimization?.status ?? 'missing result'}`,
      );
    }

    const persistedSignals = await store.readJsonl(
      OPTIMIZATION_EVENT_PATH,
      OptimizationSignalSchema,
    );
    const persisted = persistedSignals.find((signal) => signal.trace_id === traceId);

    if (!persisted || persisted.signal_id !== proposal.signalId) {
      throw new Error('Published OptimizationSignal was not found in the HEAE event store.');
    }

    const saved = await new EvaluationHistory(store).load(traceId);
    if (!saved || saved.result.judgeProvenance?.mode !== 'simulated') {
      throw new Error('Simulated judge provenance was not persisted with the evaluation.');
    }

    return {
      traceId,
      signalId: persisted.signal_id,
      publicationStatus: 'published',
      evaluationPath: path.resolve('.heae/history/heae/evaluations', `${traceId}.json`),
      signalPath: path.resolve('.heae/history', OPTIMIZATION_EVENT_PATH),
      judgeProvenance: {
        mode: 'simulated',
        provider: 'simulated-test-provider',
        model: 'controlled-simulated-judge',
      },
    };
  } finally {
    await graphStore.close();
  }
}
