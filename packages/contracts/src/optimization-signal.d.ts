import { z } from 'zod';
export declare const OPTIMIZATION_SIGNAL_SCHEMA_VERSION: '1.0';
export declare const FailureCategorySchema: z.ZodEnum<
  ['prompt', 'tool', 'retrieval', 'planning', 'multi_label']
>;
export declare const OptimizationSignalSchema: z.ZodObject<
  {
    schema_version: z.ZodLiteral<'1.0'>;
    signal_id: z.ZodString;
    trace_id: z.ZodString;
    failure_category: z.ZodEnum<['prompt', 'tool', 'retrieval', 'planning', 'multi_label']>;
    attributed_span_ids: z.ZodDefault<z.ZodArray<z.ZodString, 'many'>>;
    confidence: z.ZodNumber;
    timestamp: z.ZodString;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  },
  'strip',
  z.ZodTypeAny,
  {
    schema_version: '1.0';
    trace_id: string;
    timestamp: string;
    signal_id: string;
    failure_category: 'prompt' | 'retrieval' | 'tool' | 'planning' | 'multi_label';
    attributed_span_ids: string[];
    confidence: number;
    metadata: Record<string, unknown>;
  },
  {
    schema_version: '1.0';
    trace_id: string;
    timestamp: string;
    signal_id: string;
    failure_category: 'prompt' | 'retrieval' | 'tool' | 'planning' | 'multi_label';
    confidence: number;
    attributed_span_ids?: string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }
>;
export type OptimizationSignal = z.infer<typeof OptimizationSignalSchema>;
//# sourceMappingURL=optimization-signal.d.ts.map
