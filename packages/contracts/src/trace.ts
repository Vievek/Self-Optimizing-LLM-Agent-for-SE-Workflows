import { z } from 'zod';

export const SCHEMA_VERSION = '1.0' as const;

export const SpanNameSchema = z.enum([
  'task',
  'prompt',
  'plan',
  'tool_call',
  'retrieval',
  'route',
  'output',
]);

export const TaskSpanAttributesSchema = z
  .object({
    run_id: z.string(),
    task_id: z.string(),
    condition: z.enum(['baseline', 'amem', 'focus', 'memory_full', 'orch_off', 'orch_on']),
    config_version: z.string(),
    repo: z.string(),
    base_commit: z.string().optional(),
    'base.commit': z.string().optional(),
  })
  .passthrough();

export const PromptSpanAttributesSchema = z
  .object({
    template_id: z.string(),
    template_version: z.string(),
    model: z.string(),
    provider: z.string(),
    tokens_in: z.number().int().nonnegative(),
    tokens_out: z.number().int().nonnegative(),
  })
  .passthrough();

export const PlanSpanAttributesSchema = z
  .object({
    step_index: z.number().int().nonnegative(),
    replan_reason: z.string().nullable(),
  })
  .passthrough();

export const ToolCallSpanAttributesSchema = z
  .object({
    tool_name: z.string(),
    args: z.record(z.unknown()),
    status: z.enum(['ok', 'error']),
    error: z.string().nullable(),
    latency_ms: z.number().nonnegative(),
    retry_of: z.string().nullable(),
  })
  .passthrough();

export const RetrievalSpanAttributesSchema = z
  .object({
    source: z.enum(['code', 'memory']),
    strategy: z.enum(['graph', 'vector', 'hybrid']),
    decision_features: z.record(z.unknown()),
    query: z.string(),
    depth: z.number().int().nonnegative(),
    result_ids: z.array(z.string()),
  })
  .passthrough();

export const RouteSpanAttributesSchema = z
  .object({
    tier: z.enum(['slm', 'slim', 'llm']),
    model: z.string(),
    features: z.record(z.unknown()),
    score: z.number(),
  })
  .passthrough();

export const OutputSpanAttributesSchema = z
  .object({
    patch_hash: z.string(),
    tests_run: z.number().int().nonnegative(),
    result: z.enum(['pass', 'fail', 'error']),
  })
  .passthrough();

export const SpanLinkSchema = z.object({
  span_id: z.string().regex(/^[0-9a-f]{16}$/),
  rel: z.literal('caused_by'),
});

export const TraceSpanSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  span_id: z.string().regex(/^[0-9a-f]{16}$/),
  trace_id: z.string().regex(/^[0-9a-f]{32}$/),
  parent_span_id: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .nullable(),
  name: SpanNameSchema,
  start_ts: z.string().datetime(),
  end_ts: z.string().datetime(),
  status: z.enum(['ok', 'error']),
  attributes: z.record(z.unknown()),
  links: z.array(SpanLinkSchema).default([]),
});

export const SpanAttributesSchemas = {
  task: TaskSpanAttributesSchema,
  prompt: PromptSpanAttributesSchema,
  plan: PlanSpanAttributesSchema,
  tool_call: ToolCallSpanAttributesSchema,
  retrieval: RetrievalSpanAttributesSchema,
  route: RouteSpanAttributesSchema,
  output: OutputSpanAttributesSchema,
} as const;

export const TypedTraceSpanSchema = z.discriminatedUnion('name', [
  TraceSpanSchema.extend({
    name: z.literal('task'),
    attributes: TaskSpanAttributesSchema,
  }),
  TraceSpanSchema.extend({
    name: z.literal('prompt'),
    attributes: PromptSpanAttributesSchema,
  }),
  TraceSpanSchema.extend({
    name: z.literal('plan'),
    attributes: PlanSpanAttributesSchema,
  }),
  TraceSpanSchema.extend({
    name: z.literal('tool_call'),
    attributes: ToolCallSpanAttributesSchema,
  }),
  TraceSpanSchema.extend({
    name: z.literal('retrieval'),
    attributes: RetrievalSpanAttributesSchema,
  }),
  TraceSpanSchema.extend({
    name: z.literal('route'),
    attributes: RouteSpanAttributesSchema,
  }),
  TraceSpanSchema.extend({
    name: z.literal('output'),
    attributes: OutputSpanAttributesSchema,
  }),
]);

export type SpanName = z.infer<typeof SpanNameSchema>;
export type TaskSpanAttributes = z.infer<typeof TaskSpanAttributesSchema>;
export type PromptSpanAttributes = z.infer<typeof PromptSpanAttributesSchema>;
export type PlanSpanAttributes = z.infer<typeof PlanSpanAttributesSchema>;
export type ToolCallSpanAttributes = z.infer<typeof ToolCallSpanAttributesSchema>;
export type RetrievalSpanAttributes = z.infer<typeof RetrievalSpanAttributesSchema>;
export type RouteSpanAttributes = z.infer<typeof RouteSpanAttributesSchema>;
export type OutputSpanAttributes = z.infer<typeof OutputSpanAttributesSchema>;
export type SpanLink = z.infer<typeof SpanLinkSchema>;
export type TraceSpan = z.infer<typeof TraceSpanSchema>;
export type TypedTraceSpan = z.infer<typeof TypedTraceSpanSchema>;
