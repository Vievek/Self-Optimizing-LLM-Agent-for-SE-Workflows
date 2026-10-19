
import type {
  OutcomeEvidence,
  OptimizationSignal,
} from '@soa/contracts';

import type { Store } from '@soa/store';

import {
  EvaluationHistory,
} from '../persistence/evaluation-history.js';

import type {
  OutcomeEvidenceInput,
} from '../evidence/outcome-evidence-generator.js';

import type {
  ReviewedOptimizationProposal,
} from '../signals/optimization-signal-generator.js';

import {
  publishOutcomeEvidence,
  publishOptimizationSignal,
  type PublicationResult,
} from '../events/heae-event-publisher.js';

export interface PublishEvaluationEventsOptions {
  store: Store;

  /**
   * Externally verified execution information.
   */
  outcomeInput?: OutcomeEvidenceInput;

  /**
   * Optional reviewed optimization proposal.
   */
  optimizationProposal?: ReviewedOptimizationProposal;
}

export interface PublishEvaluationEventsResult {
  traceId: string;

  outcome: PublicationResult<OutcomeEvidence> | null;

  optimization:
    PublicationResult<OptimizationSignal> | null;
}

/**
 * Publish downstream events from a saved HEAE evaluation.
 *
 * This does not rerun attribution or the LLM judge.
 * It does not modify existing evaluation history.
 *
 * Each event is published independently, so retries
 * can recover from a partial publication failure.
 */
export async function publishEvaluationEvents(
  traceId: string,
  options: PublishEvaluationEventsOptions,
): Promise<PublishEvaluationEventsResult> {
  const {
    store,
    outcomeInput,
    optimizationProposal,
  } = options;

  if (!outcomeInput && !optimizationProposal) {
    throw new Error(
      'At least one event publication input is required.',
    );
  }

  const history = new EvaluationHistory(store);

  // Validate trace ID and read previously saved data.
  const saved = await history.load(traceId);

  if (!saved) {
    throw new Error(
      `Saved HEAE evaluation not found: ${traceId}`,
    );
  }

  const attribution = saved.result;

  // Check all requested event identities BEFORE
  // publishing either event. This avoids partially
  // publishing when the other request is inconsistent.
  if (outcomeInput && optimizationProposal) {
    if (
      outcomeInput.runId !== optimizationProposal.runId ||
      outcomeInput.taskId !== optimizationProposal.taskId
    ) {
      throw new Error(
        'Publication identity mismatch: outcome and ' +
        'optimization inputs refer to different executions.',
      );
    }
  }

  // All generated event trace IDs come from the
  // saved attribution, not from caller-supplied values.
  if (attribution.traceId !== saved.traceId) {
    throw new Error(
      'Stored evaluation trace identity mismatch.',
    );
  }

  let outcome: PublicationResult<OutcomeEvidence> | null =
    null;

  let optimization:
    PublicationResult<OptimizationSignal> | null = null;

  // OutcomeEvidence requires verified execution facts.
  if (outcomeInput) {
    outcome = await publishOutcomeEvidence(
      store,
      attribution,
      outcomeInput,
    );
  }

  // OptimizationSignal requires a reviewed proposal
  // and a completed supported LLM judgment.
  if (optimizationProposal) {
    optimization = await publishOptimizationSignal(
      store,
      attribution,
      optimizationProposal,
    );
  }

  return {
    traceId: saved.traceId,
    outcome,
    optimization,
  };
}
