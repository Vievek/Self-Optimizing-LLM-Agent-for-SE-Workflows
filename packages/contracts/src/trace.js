import { z } from 'zod';
export const SCHEMA_VERSION = '1.0';
export const SpanNameSchema = z.enum([
    'task',
    'prompt',
    'plan',
    'tool_call',
    'retrieval',
    'route',
    'output',
]);
export const HeaeNodeKeySchema = z.object({
// Add fields as you finalize the schema
});
export const TraceSpanSchema = z.object({
    schema_version: z.literal(SCHEMA_VERSION),
    span_id: z.string().regex(/^[0-9a-f]{16}$/),
    trace_id: z.string().regex(/^[0-9a-f]{32}$/),
    parent_span_id: z.string().regex(/^[0-9a-f]{16}$/).nullable(),
    name: SpanNameSchema,
    start_ts: z.string().datetime(),
    end_ts: z.string().datetime(),
    status: z.enum(['ok', 'error']),
    attributes: z.record(z.unknown()),
    links: z.array(z.object({
        span_id: z.string().regex(/^[0-9a-f]{16}$/),
        rel: z.string(),
    })).default([]),
});
//# sourceMappingURL=trace.js.map