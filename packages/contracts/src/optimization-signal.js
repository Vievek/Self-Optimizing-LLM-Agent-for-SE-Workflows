import { z } from 'zod';
export const OPTIMIZATION_SIGNAL_SCHEMA_VERSION = '1.0';
export const FailureCategorySchema = z.enum([
    'prompt',
    'tool',
    'retrieval',
    'planning',
    'multi_label',
]);
export const OptimizationSignalSchema = z.object({
    schema_version: z.literal(OPTIMIZATION_SIGNAL_SCHEMA_VERSION),
    signal_id: z.string(),
    trace_id: z.string().regex(/^[0-9a-f]{32}$/),
    failure_category: FailureCategorySchema,
    attributed_span_ids: z.array(z.string().regex(/^[0-9a-f]{16}$/)).default([]),
    confidence: z.number().min(0).max(1),
    timestamp: z.string().datetime(),
    metadata: z.record(z.unknown()).default({}),
});
//# sourceMappingURL=optimization-signal.js.map