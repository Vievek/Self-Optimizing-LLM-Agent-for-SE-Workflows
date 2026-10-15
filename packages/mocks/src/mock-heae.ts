import {
  OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
  generateSignalId,
  type OptimizationSignal,
  type OutcomeEvidence,
  type TraceSpan,
} from '@soa/contracts';

export class MockHeae {
  async evaluateAndAttribute(
    evidence: OutcomeEvidence,
    _spans: TraceSpan[],
  ): Promise<OptimizationSignal[]> {
    const signalId = generateSignalId(evidence.run_id, evidence.task_id, 1);
    const groupId = `grp_${evidence.task_id}_01`;

    return [
      {
        schema_version: OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
        signal_id: signalId,
        group_id: groupId,
        run_id: evidence.run_id,
        task_id: evidence.task_id,
        trace_id: evidence.trace_id,
        failure_class: 'tool',
        root_cause: {
          summary: 'Tool invocation parameters or description mismatched expected repository API',
          evidence_node_ids: evidence.failure_labels[0]?.node_ids ?? [],
        },
        target: {
          axis: 'tool',
          config_path: 'tools.apply_patch.description',
          affected_subtask: 'tool_execution',
        },
        suggested_action: 'tool_description_refine',
        confidence: 0.92,
        classifier: 'rule',
        config_version_at_failure: 'cfg_0001',
      },
    ];
  }
}
