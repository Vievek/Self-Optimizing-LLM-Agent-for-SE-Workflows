import {
  SCHEMA_VERSION,
  TraceSpan,
  generateTraceId,
  generateSpanId,
  generateRunId,
} from '@soa/contracts';

export class MockExecCore {
  async runTask(taskId: string, runId?: string): Promise<{ spans: TraceSpan[]; output: string }> {
    const traceId = generateTraceId();
    const effectiveRunId = runId || generateRunId('baseline', 1);
    const taskSpanId = generateSpanId();
    const planSpanId = generateSpanId();
    const retrievalSpanId = generateSpanId();
    const toolCallSpanId = generateSpanId();
    const outputSpanId = generateSpanId();

    const now = new Date();
    const startTs = now.toISOString();
    const endTs = new Date(now.getTime() + 5000).toISOString();

    const spans: TraceSpan[] = [
      {
        schema_version: SCHEMA_VERSION,
        span_id: taskSpanId,
        trace_id: traceId,
        parent_span_id: null,
        name: 'task',
        start_ts: startTs,
        end_ts: endTs,
        status: 'ok',
        attributes: {
          run_id: effectiveRunId,
          task_id: taskId,
          condition: 'baseline',
          config_version: 'cfg_0001',
          repo: taskId.startsWith('django') ? 'django/django' : 'sympy/sympy',
          base_commit: 'fb8b75e7a9b8f2d',
        },
        links: [],
      },
      {
        schema_version: SCHEMA_VERSION,
        span_id: planSpanId,
        trace_id: traceId,
        parent_span_id: taskSpanId,
        name: 'plan',
        start_ts: startTs,
        end_ts: endTs,
        status: 'ok',
        attributes: {
          step_index: 0,
          replan_reason: null,
        },
        links: [{ span_id: taskSpanId, rel: 'caused_by' }],
      },
      {
        schema_version: SCHEMA_VERSION,
        span_id: retrievalSpanId,
        trace_id: traceId,
        parent_span_id: planSpanId,
        name: 'retrieval',
        start_ts: startTs,
        end_ts: endTs,
        status: 'ok',
        attributes: {
          source: 'memory',
          strategy: 'hybrid',
          decision_features: { query_type: 'memory_lookup' },
          query: 'fix regex validation bug',
          depth: 1,
          result_ids: ['mem_01J9X8ABCDEF0123456789ABCD'],
        },
        links: [{ span_id: planSpanId, rel: 'caused_by' }],
      },
      {
        schema_version: SCHEMA_VERSION,
        span_id: toolCallSpanId,
        trace_id: traceId,
        parent_span_id: planSpanId,
        name: 'tool_call',
        start_ts: startTs,
        end_ts: endTs,
        status: 'ok',
        attributes: {
          tool_name: 'apply_patch',
          args: { file: 'django/contrib/auth/validators.py' },
          status: 'ok',
          error: null,
          latency_ms: 120,
          retry_of: null,
        },
        links: [{ span_id: planSpanId, rel: 'caused_by' }],
      },
      {
        schema_version: SCHEMA_VERSION,
        span_id: outputSpanId,
        trace_id: traceId,
        parent_span_id: taskSpanId,
        name: 'output',
        start_ts: startTs,
        end_ts: endTs,
        status: 'ok',
        attributes: {
          patch_hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
          tests_run: 5,
          tests_passed: 5,
          tests_failed: 0,
          result: 'pass',
        },
        links: [{ span_id: toolCallSpanId, rel: 'caused_by' }],
      },
    ];

    return {
      spans,
      output: `Mock executed task ${taskId}`,
    };
  }
}
