import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TraceSpanSchema,
  TypedTraceSpanSchema,
  TaskSpanAttributesSchema,
  PromptSpanAttributesSchema,
  PlanSpanAttributesSchema,
  ToolCallSpanAttributesSchema,
  RetrievalSpanAttributesSchema,
  RouteSpanAttributesSchema,
  OutputSpanAttributesSchema,
  SCHEMA_VERSION,
} from './trace.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = resolve(__dirname, '../../../fixtures/traces/success.jsonl');
const successTrace = readFileSync(fixturePath, 'utf-8');

describe('TraceSpanSchema Contract Tests', () => {
  it('validates every span in the success fixture', () => {
    const lines = successTrace.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      const span = JSON.parse(line);
      expect(() => TraceSpanSchema.parse(span)).not.toThrow();
      expect(() => TypedTraceSpanSchema.parse(span)).not.toThrow();
    }
  });

  it('rejects a span with a bad trace_id', () => {
    const bad = {
      schema_version: SCHEMA_VERSION,
      span_id: '1000000000000001',
      trace_id: 'not-a-32-hex-trace-id',
      parent_span_id: null,
      name: 'task',
      start_ts: '2026-10-12T09:00:00.000Z',
      end_ts: '2026-10-12T09:00:15.000Z',
      status: 'ok',
      attributes: {},
      links: [],
    };
    expect(() => TraceSpanSchema.parse(bad)).toThrow();
  });

  it('rejects a span with a bad span_id', () => {
    const bad = {
      schema_version: SCHEMA_VERSION,
      span_id: 'bad-span-id',
      trace_id: '0123456789abcdef0123456789abcdef',
      parent_span_id: null,
      name: 'task',
      start_ts: '2026-10-12T09:00:00.000Z',
      end_ts: '2026-10-12T09:00:15.000Z',
      status: 'ok',
      attributes: {},
      links: [],
    };
    expect(() => TraceSpanSchema.parse(bad)).toThrow();
  });

  it('rejects a span with wrong schema_version', () => {
    const bad = {
      schema_version: '0.9',
      span_id: '1000000000000001',
      trace_id: '0123456789abcdef0123456789abcdef',
      parent_span_id: null,
      name: 'task',
      start_ts: '2026-10-12T09:00:00.000Z',
      end_ts: '2026-10-12T09:00:15.000Z',
      status: 'ok',
      attributes: {},
      links: [],
    };
    expect(() => TraceSpanSchema.parse(bad)).toThrow();
  });

  it('rejects a span link with invalid rel', () => {
    const bad = {
      schema_version: SCHEMA_VERSION,
      span_id: '1000000000000002',
      trace_id: '0123456789abcdef0123456789abcdef',
      parent_span_id: '1000000000000001',
      name: 'plan',
      start_ts: '2026-10-12T09:00:00.100Z',
      end_ts: '2026-10-12T09:00:00.500Z',
      status: 'ok',
      attributes: { step_index: 0, replan_reason: null },
      links: [{ span_id: '1000000000000001', rel: 'invalid_rel' }],
    };
    expect(() => TraceSpanSchema.parse(bad)).toThrow();
  });

  it('validates each typed attribute schema', () => {
    expect(() =>
      TaskSpanAttributesSchema.parse({
        run_id: 'run_01',
        task_id: 'django__django-11099',
        condition: 'baseline',
        config_version: 'cfg_0001',
        repo: 'django/django',
        base_commit: 'abc1234',
      }),
    ).not.toThrow();

    expect(() =>
      PromptSpanAttributesSchema.parse({
        template_id: 'tmpl_1',
        template_version: '1.0',
        model: 'qwen',
        provider: 'hf',
        tokens_in: 100,
        tokens_out: 50,
      }),
    ).not.toThrow();

    expect(() =>
      PlanSpanAttributesSchema.parse({
        step_index: 1,
        replan_reason: 'failed tests',
      }),
    ).not.toThrow();

    expect(() =>
      ToolCallSpanAttributesSchema.parse({
        tool_name: 'exec',
        args: { cmd: 'ls' },
        status: 'ok',
        error: null,
        latency_ms: 45.2,
        retry_of: null,
      }),
    ).not.toThrow();

    expect(() =>
      RetrievalSpanAttributesSchema.parse({
        source: 'code',
        strategy: 'hybrid',
        decision_features: {},
        query: 'search query',
        depth: 2,
        result_ids: ['id1', 'id2'],
      }),
    ).not.toThrow();

    expect(() =>
      RouteSpanAttributesSchema.parse({
        tier: 'slm',
        model: 'model-small',
        features: {},
        score: 0.9,
      }),
    ).not.toThrow();

    expect(() =>
      OutputSpanAttributesSchema.parse({
        patch_hash: 'hash123',
        tests_run: 10,
        result: 'pass',
      }),
    ).not.toThrow();
  });
});
