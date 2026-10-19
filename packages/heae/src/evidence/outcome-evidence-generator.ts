
import {
  OUTCOME_EVIDENCE_SCHEMA_VERSION,
  OutcomeEvidenceSchema,
  type ExecutionCost,
  type FailureLabel,
  type MemoryUseRecord,
  type OutcomeDetails,
  type OutcomeEvidence,
} from '@soa/contracts';

import type {
  HybridAttributionResult,
} from '../attribution/hybrid-attribution.js';

export interface OutcomeEvidenceInput {
  evidenceId: string;
  runId: string;
  taskId: string;
  repo: string;
  baseCommit: string;

  // Verified execution data, not inferred from rule findings.
  outcome: OutcomeDetails;
  cost: ExecutionCost;

  // Optional externally verified memory usage.
  memoryUses?: MemoryUseRecord[];
  memoryUsesReviewed?: boolean;

  // Optional reviewed failure classifications.
  failureLabels?: FailureLabel[];
}

export type OutcomeEvidenceGenerationResult =
  | {
      status: 'generated';
      evidence: OutcomeEvidence;
      reason: null;
    }
  | {
      status: 'skipped';
      evidence: null;
      reason: string;
    };

function skip(
  reason: string,
): OutcomeEvidenceGenerationResult {
  return {
    status: 'skipped',
    evidence: null,
    reason,
  };
}

export function generateOutcomeEvidence(
  attribution: HybridAttributionResult,
  input: OutcomeEvidenceInput,
): OutcomeEvidenceGenerationResult {
  const memoryUses = input.memoryUses ?? [];
  const failureLabels = input.failureLabels ?? [];

  // Memory implication and citation data must be verified
  // externally. HEAE cannot infer those from rule findings.
  if (memoryUses.length > 0 && !input.memoryUsesReviewed) {
    return skip(
      'Memory use records require external review.',
    );
  }

  const seenClasses = new Set<string>();

  for (const label of failureLabels) {
    if (seenClasses.has(label.class)) {
      return skip(
        `Duplicate failure label: ${label.class}`,
      );
    }

    seenClasses.add(label.class);

    if (label.node_ids.length === 0) {
      return skip(
        `Failure label ${label.class} has no evidence.`,
      );
    }

    if (
      attribution.judgeStatus !== 'completed' ||
      !attribution.judgment
    ) {
      return skip(
        'Failure labels require a completed LLM judgment.',
      );
    }

    const hypothesis =
      attribution.ruleReport.hypotheses.find(
        (item) => item.category === label.class,
      );

    const judgment =
      attribution.judgment.findings.find(
        (item) => item.category === label.class,
      );

    if (
      !hypothesis ||
      !judgment ||
      judgment.assessment !== 'supported'
    ) {
      return skip(
        `Failure label ${label.class} is not supported.`,
      );
    }

    const allowedIds = new Set(
      hypothesis.evidenceNodeIds.filter((id) =>
        judgment.evidenceNodeIds.includes(id),
      ),
    );

    if (
      label.node_ids.some((id) => !allowedIds.has(id))
    ) {
      return skip(
        `Failure label ${label.class} references unsupported evidence.`,
      );
    }
  }

  const candidate = {
    schema_version: OUTCOME_EVIDENCE_SCHEMA_VERSION,
    evidence_id: input.evidenceId,
    run_id: input.runId,
    task_id: input.taskId,
    trace_id: attribution.traceId,
    repo: input.repo,
    base_commit: input.baseCommit,
    outcome: input.outcome,
    memory_uses: memoryUses,
    failure_labels: failureLabels,
    cost: input.cost,
  };

  const validation =
    OutcomeEvidenceSchema.safeParse(candidate);

  if (!validation.success) {
    return skip(
      'Outcome Evidence failed the shared v2.0 schema.',
    );
  }

  return {
    status: 'generated',
    evidence: validation.data,
    reason: null,
  };
}
