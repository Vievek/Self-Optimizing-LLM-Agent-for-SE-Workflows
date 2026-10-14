import {
  OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
  type OptimizationSignal,
  type OutcomeEvidence,
  type TraceSpan,
} from '@soa/contracts';

export class MockHeae {
  async evaluateAndAttribute(
    evidence: OutcomeEvidence,
    _spans: TraceSpan[],
  ): Promise<OptimizationSignal[]> {
    const mockId = `mock_${Date.now()}`;

    return [
      {
        schema_version: OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
        signal_id: `sig_${mockId}`,
        group_id: `grp_${mockId}`,
        run_id: `run_${mockId}`,
        task_id: evidence.task_id,
        trace_id: evidence.trace_id,
        failure_class: 'tool',
        root_cause: {
          summary: 'Mock tool failure for offline evaluation',
          evidence_node_ids: [],
        },
        target: {
          axis: 'tool',
          config_path: 'mock.tool.description',
          affected_subtask: 'mock_tool_execution',
        },
        suggested_action: 'tool_description_refine',
        confidence: 0.9,
        classifier: 'rule',
        config_version_at_failure: 'cfg_0000',
      },
    ];
  }
}
