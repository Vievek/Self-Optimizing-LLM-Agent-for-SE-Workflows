
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
 * Event destinations relative to the Store root.
 *
 * With FileStore('store'), these become:
 *
 * store/events/outcome_evidence.jsonl
 * store/events/optimization_signals.jsonl
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
 * Compare two schema-normalized JSON records.
 *
 * This assumes stable serialization of records
 * produced and validated through the shared schemas.
 */
function sameRecord(
  left: unknown,
  right: unknown,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Publish externally verified OutcomeEvidence.
 *
 * Guarantees for sequential calls:
 *
 * - Validates the generated evidence.
 * - Validates previously saved evidence records.
 * - Prevents duplicate publication.
 * - Detects conflicting execution identities.
 *
 * This assumes a single-writer HEAE process.
 */
export async function publishOutcomeEvidence(
  store: Store,
  attribution: HybridAttributionResult,
  input: OutcomeEvidenceInput,
): Promise<PublicationResult<OutcomeEvidence>> {
  // STEP 1: Generate outcome evidence.
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

  // STEP 2: Validate the new evidence record.
  const candidate: OutcomeEvidence =
    OutcomeEvidenceSchema.parse(
      generated.evidence,
    );

  // STEP 3: Read and validate all previously
  // published OutcomeEvidence records.
  //
  // Zod defaults allow optional input fields, so
  // passing this schema directly to Store.readJsonl
  // creates a TypeScript input/output mismatch.
  //
  // Parse the returned unknown records separately.
  const existing = OutcomeEvidenceSchema.array().parse(
    await store.readJsonl<unknown>(
      OUTCOME_EVENT_PATH,
    ),
  );

  // STEP 4: Check for duplicates and conflicts.
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

    // Identical record: safe sequential retry.
    if (sameRecord(record, candidate)) {
      return {
        status: 'already_exists',
        event: record,
        reason: null,
      };
    }

    // Never silently replace or append conflicting
    // evidence for the same execution.
    throw new Error(
      'OutcomeEvidence publication conflict: ' +
      'an existing record has the same event ID ' +
      'or execution identity but different content.',
    );
  }

  // STEP 5: Append the validated event.
  //
  // The candidate has already passed Zod validation.
  // No schema argument is required for Store.append().
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
 * Publish an evidence-supported OptimizationSignal.
 *
 * The generator requires:
 *
 * - A reviewed optimization proposal.
 * - A completed LLM judgment.
 * - A supported failure hypothesis.
 * - Evidence IDs supported by the judgment.
 *
 * Skipped proposals do not create any JSONL record.
 */
export async function publishOptimizationSignal(
  store: Store,
  attribution: HybridAttributionResult,
  proposal: ReviewedOptimizationProposal,
): Promise<PublicationResult<OptimizationSignal>> {
  // STEP 1: Generate the signal.
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

  // STEP 2: Validate the proposed signal.
  const candidate: OptimizationSignal =
    OptimizationSignalSchema.parse(
      generated.signal,
    );

  // STEP 3: Read previously published signals
  // with schema validation.
  const existing =
    await store.readJsonl<OptimizationSignal>(
      OPTIMIZATION_EVENT_PATH,
      OptimizationSignalSchema,
    );

  // STEP 4: Reject conflicting signal IDs and
  // prevent duplicate appends.
  for (const record of existing) {
    if (record.signal_id !== candidate.signal_id) {
      continue;
    }

    // Same signal already published.
    if (sameRecord(record, candidate)) {
      return {
        status: 'already_exists',
        event: record,
        reason: null,
      };
    }

    throw new Error(
      'OptimizationSignal publication conflict: ' +
      `signal ID ${candidate.signal_id} ` +
      'already exists with different content.',
    );
  }

  // STEP 5: Append the schema-validated signal.
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
