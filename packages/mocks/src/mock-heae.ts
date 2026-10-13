import { OptimizationSignal, OutcomeEvidence, TraceSpan } from '@soa/contracts';

export class MockHeae {
  async evaluateAndAttribute(
    evidence: OutcomeEvidence,
    _spans: TraceSpan[],
  ): Promise<OptimizationSignal[]> {
    return [
      {
        schema_version: '1.0',
        signal_id: `sig-${Date.now()}`,
        trace_id: evidence.trace_id,
        failure_category: 'tool',
        attributed_span_ids: [],
        confidence: 0.9,
        timestamp: new Date().toISOString(),
        metadata: {},
      },
    ];
  }
}
