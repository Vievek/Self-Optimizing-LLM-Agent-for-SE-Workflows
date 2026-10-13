import { z } from 'zod';
export declare const OUTCOME_EVIDENCE_SCHEMA_VERSION: '1.0';
export declare const OutcomeEvidenceSchema: z.ZodObject<
  {
    schema_version: z.ZodLiteral<'1.0'>;
    task_id: z.ZodString;
    trace_id: z.ZodString;
    test_status: z.ZodEnum<['passed', 'failed', 'error']>;
    timestamp: z.ZodString;
    details: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  },
  'strip',
  z.ZodTypeAny,
  {
    schema_version: '1.0';
    trace_id: string;
    task_id: string;
    test_status: 'error' | 'passed' | 'failed';
    timestamp: string;
    details: Record<string, unknown>;
  },
  {
    schema_version: '1.0';
    trace_id: string;
    task_id: string;
    test_status: 'error' | 'passed' | 'failed';
    timestamp: string;
    details?: Record<string, unknown> | undefined;
  }
>;
export type OutcomeEvidence = z.infer<typeof OutcomeEvidenceSchema>;
//# sourceMappingURL=outcome-evidence.d.ts.map
