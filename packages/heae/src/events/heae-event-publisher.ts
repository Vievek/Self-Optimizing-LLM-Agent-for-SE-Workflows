
import {
  OutcomeEvidenceSchema,
  OptimizationSignalSchema,
  type OutcomeEvidence,
  type OptimizationSignal,
} from '@soa/contracts';

import type { Store } from '@soa/store';

import type {
  HybridAttributionResult,
} from '../attribution/hybrid-attribution.js';

import {
  generateOutcomeEvidence,
  type OutcomeEvidenceInput,
} from '../evidence/outcome-evidence-generator.js';

import {
  generateOptimizationSignal,
  type ReviewedOptimizationProposal,
} from '../signals/optimization-signal-generator.js';

/**
 * Event destinations are relative to FileStore's
 * root directory (normally "store").
 */
export const OUTCOME_EVENT_PATH =
  'events/outcome_evidence.jsonl';

export const OPTIMIZATION_EVENT_PATH =
  'events/optimization_signals.jsonl';

export type PublicationStatus =
  | 'published'
  | 'already_exists'
  | 'skipped';

export interface PublicationResult<T> {
  status: PublicationStatus;
  event: T | null;
  reason: string | null;
}

/**
 * Compare validated event records.
 *
 * Both records are normalized through their Zod
 * schemas before reaching this function.
 */
function sameRecord(
  left: unknown,
  right: unknown,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Publish verified OutcomeEvidence.
 *
 * The outcome generator requires externally verified
 * execution details. Rule findings alone are not
 * sufficient to establish execution facts.
 *
 * Duplicate protection assumes the architecture's
 * single-writer HEAE process.
 */
export async function publishOutcomeEvidence(
  store: Store,
  attribution: HybridAttributionResult,
  input: OutcomeEvidenceInput,
): Promise<PublicationResult<OutcomeEvidence>> {
  // Step 1: Generate and validate outcome evidence.
  const generated = generateOutcomeEvidence(
    attribution,
    input,
  );

  if (generated.status === 'skipped') {
    return {
      status: 'skipped',
      event: null,
      reason: generated.reason,
    };
  }

  const candidate: OutcomeEvidence =
    OutcomeEvidenceSchema.parse(generated.evidence);

  // Step 2: Load existing outcome events with explicit
  // TypeScript typing and Zod validation.
  const existing = await store.readJsonl<OutcomeEvidence>(
    OUTCOME_EVENT_PATH,
  );

  // Step 3: Check for duplicate IDs or executions.
  for (const record of existing) {
    const sameId =
      record.evidence_id === candidate.evidence_id;

    const sameExecution =
      record.trace_id === candidate.trace_id &&
      record.run_id === candidate.run_id &&
      record.task_id === candidate.task_id;

    if (!sameId && !sameExecution) {
      continue;
    }

    // An identical event was already published.
    if (sameRecord(record, candidate)) {
      return {
        status: 'already_exists',
        event: record,
        reason: null,
      };
    }

    // Prevent two different records from claiming
    // the same ID or execution identity.
    throw new Error(
      'OutcomeEvidence publication conflict: ' +
      'an existing record has the same event ID ' +
      'or execution identity but different content.',
    );
  }

  // Step 4: Append the validated event.
  await store.append<OutcomeEvidence>(
    OUTCOME_EVENT_PATH,
    candidate,
  );

  return {
    status: 'published',
    event: candidate,
    reason: null,
  };
}

/**
 * Publish a reviewed OptimizationSignal.
 *
 * The generator checks whether:
 * - The proposal was reviewed.
 * - LLM judgment is completed.
 * - The failure hypothesis is supported.
 * - Evidence node IDs match the supported finding.
 *
 * Unreviewed or unsupported proposals are skipped.
 */
export async function publishOptimizationSignal(
  store: Store,
  attribution: HybridAttributionResult,
  proposal: ReviewedOptimizationProposal,
): Promise<PublicationResult<OptimizationSignal>> {
  // Step 1: Generate and validate optimization signal.
  const generated = generateOptimizationSignal(
    attribution,
    proposal,
  );

  if (generated.status === 'skipped') {
    return {
      status: 'skipped',
      event: null,
      reason: generated.reason,
    };
  }

  const candidate: OptimizationSignal =
    OptimizationSignalSchema.parse(generated.signal);

  // Step 2: Read existing signals with explicit typing.
  const existing =
    await store.readJsonl<OptimizationSignal>(
      OPTIMIZATION_EVENT_PATH,
      OptimizationSignalSchema,
    );

  // Step 3: Check for duplicate signal IDs.
  for (const record of existing) {
    if (record.signal_id !== candidate.signal_id) {
      continue;
    }

    // Exact retry: return the previously stored event.
    if (sameRecord(record, candidate)) {
      return {
        status: 'already_exists',
        event: record,
        reason: null,
      };
    }

    // Same signal ID with different content is unsafe.
    throw new Error(
      'OptimizationSignal publication conflict: ' +
      `signal ID ${candidate.signal_id} ` +
      'already exists with different content.',
    );
  }

  // Step 4: Append the validated signal.
  await store.append<OptimizationSignal>(
    OPTIMIZATION_EVENT_PATH,
    candidate,
    OptimizationSignalSchema,
  );

  return {
    status: 'published',
    event: candidate,
    reason: null,
  };
}
