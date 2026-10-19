
import {
  OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
  OptimizationSignalSchema,
  type FailureClass,
  type OptimizationSignal,
  type OptimizationTargetAxis,
  type SuggestedAction,
} from '@soa/contracts';

import type {
  HybridAttributionResult,
} from '../attribution/hybrid-attribution.js';

export interface ReviewedOptimizationProposal {
  reviewed: boolean;
  signalId: string;
  groupId: string;
  runId: string;
  taskId: string;
  failureClass: FailureClass;
  rootCauseSummary: string;
  evidenceNodeIds: string[];
  targetAxis: OptimizationTargetAxis;
  configPath: string;
  affectedSubtask: string;
  suggestedAction: SuggestedAction;
  confidence: number;
  configVersionAtFailure: string;
}

export type SignalGenerationResult =
  | {
      status: 'generated';
      signal: OptimizationSignal;
      reason: null;
    }
  | {
      status: 'skipped';
      signal: null;
      reason: string;
    };

function skip(reason: string): SignalGenerationResult {
  return {
    status: 'skipped',
    signal: null,
    reason,
  };
}

export function generateOptimizationSignal(
  attribution: HybridAttributionResult,
  proposal: ReviewedOptimizationProposal,
): SignalGenerationResult {
  if (!proposal.reviewed) {
    return skip('Optimization proposal has not been reviewed.');
  }

  if (
    attribution.judgeStatus !== 'completed' ||
    !attribution.judgment
  ) {
    return skip('LLM judgment is unavailable.');
  }

  if (attribution.ruleReport.outcome === 'pass') {
    return skip('The evaluated task completed successfully.');
  }

  const hypothesis = attribution.ruleReport.hypotheses.find(
    (item) => item.category === proposal.failureClass,
  );

  if (!hypothesis) {
    return skip('No matching rule-based hypothesis.');
  }

  const judgment = attribution.judgment.findings.find(
    (item) => item.category === proposal.failureClass,
  );

  if (!judgment || judgment.assessment !== 'supported') {
    return skip('The hypothesis is not supported by the judge.');
  }

  if (proposal.evidenceNodeIds.length === 0) {
    return skip('The proposal has no evidence node IDs.');
  }

  const allowedEvidence = new Set(
    hypothesis.evidenceNodeIds.filter((id) =>
      judgment.evidenceNodeIds.includes(id),
    ),
  );

  if (
    proposal.evidenceNodeIds.some(
      (id) => !allowedEvidence.has(id),
    )
  ) {
    return skip('The proposal references unsupported evidence.');
  }

  if (!proposal.rootCauseSummary.trim()) {
    return skip('A reviewed root-cause summary is required.');
  }

  if (!proposal.configPath.trim()) {
    return skip('A configuration target is required.');
  }

  const candidate: OptimizationSignal = {
    schema_version: OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
    signal_id: proposal.signalId,
    group_id: proposal.groupId,
    run_id: proposal.runId,
    task_id: proposal.taskId,
    trace_id: attribution.traceId,
    failure_class: proposal.failureClass,
    root_cause: {
      summary: proposal.rootCauseSummary,
      evidence_node_ids: [...new Set(proposal.evidenceNodeIds)],
    },
    target: {
      axis: proposal.targetAxis,
      config_path: proposal.configPath,
      affected_subtask: proposal.affectedSubtask,
    },
    suggested_action: proposal.suggestedAction,
    confidence: proposal.confidence,
    classifier: 'llm_judge',
    config_version_at_failure: proposal.configVersionAtFailure,
  };

  const validation = OptimizationSignalSchema.safeParse(candidate);

  if (!validation.success) {
    return skip('Signal failed the shared v2.0 schema.');
  }

  return {
    status: 'generated',
    signal: validation.data,
    reason: null,
  };
}
