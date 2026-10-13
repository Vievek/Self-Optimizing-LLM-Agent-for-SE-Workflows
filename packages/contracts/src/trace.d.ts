import { z } from 'zod';
export declare const SCHEMA_VERSION: '1.0';
export declare const SpanNameSchema: z.ZodEnum<
  ['task', 'prompt', 'plan', 'tool_call', 'retrieval', 'route', 'output']
>;
export declare const HeaeNodeKeySchema: z.ZodObject<{}, 'strip', z.ZodTypeAny, {}, {}>;
export declare const TraceSpanSchema: z.ZodObject<
  {
    schema_version: z.ZodLiteral<'1.0'>;
    span_id: z.ZodString;
    trace_id: z.ZodString;
    parent_span_id: z.ZodNullable<z.ZodString>;
    name: z.ZodEnum<['task', 'prompt', 'plan', 'tool_call', 'retrieval', 'route', 'output']>;
    start_ts: z.ZodString;
    end_ts: z.ZodString;
    status: z.ZodEnum<['ok', 'error']>;
    attributes: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    links: z.ZodDefault<
      z.ZodArray<
        z.ZodObject<
          {
            span_id: z.ZodString;
            rel: z.ZodString;
          },
          'strip',
          z.ZodTypeAny,
          {
            span_id: string;
            rel: string;
          },
          {
            span_id: string;
            rel: string;
          }
        >,
        'many'
      >
    >;
  },
  'strip',
  z.ZodTypeAny,
  {
    schema_version: '1.0';
    status: 'ok' | 'error';
    span_id: string;
    trace_id: string;
    parent_span_id: string | null;
    name: 'task' | 'prompt' | 'plan' | 'tool_call' | 'retrieval' | 'route' | 'output';
    start_ts: string;
    end_ts: string;
    attributes: Record<string, unknown>;
    links: {
      span_id: string;
      rel: string;
    }[];
  },
  {
    schema_version: '1.0';
    status: 'ok' | 'error';
    span_id: string;
    trace_id: string;
    parent_span_id: string | null;
    name: 'task' | 'prompt' | 'plan' | 'tool_call' | 'retrieval' | 'route' | 'output';
    start_ts: string;
    end_ts: string;
    attributes: Record<string, unknown>;
    links?:
      | {
          span_id: string;
          rel: string;
        }[]
      | undefined;
  }
>;
export type TraceSpan = z.infer<typeof TraceSpanSchema>;
//# sourceMappingURL=trace.d.ts.map
