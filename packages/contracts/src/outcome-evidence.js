import { z } from 'zod';
export const OUTCOME_EVIDENCE_SCHEMA_VERSION = '1.0';
export const OutcomeEvidenceSchema = z.object({
    schema_version: z.literal(OUTCOME_EVIDENCE_SCHEMA_VERSION),
    task_id: z.string(),
    trace_id: z.string().regex(/^[0-9a-f]{32}$/),
    test_status: z.enum(['passed', 'failed', 'error']),
    timestamp: z.string().datetime(),
    details: z.record(z.unknown()).default({}),
});
//# sourceMappingURL=outcome-evidence.js.map