import { describe, it, expect } from 'vitest';
import { TraceSpanSchema, SCHEMA_VERSION } from './trace.js';
import { OutcomeEvidenceSchema, OUTCOME_EVIDENCE_SCHEMA_VERSION } from './outcome-evidence.js';
import {
  OptimizationSignalSchema,
  OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
} from './optimization-signal.js';
import { ConfigSchema, CONFIG_SCHEMA_VERSION } from './config.js';

describe('Contracts Schema Validation', () => {
  it('validates a minimal trace span', () => {
    const validSpan = {
      schema_version: SCHEMA_VERSION,
      span_id: '0123456789abcdef',
      trace_id: '0123456789abcdef0123456789abcdef',
      parent_span_id: null,
      name: 'task',
      start_ts: new Date().toISOString(),
      end_ts: new Date().toISOString(),
      status: 'ok',
      attributes: {},
      links: [],
    };
    const parsed = TraceSpanSchema.safeParse(validSpan);
    expect(parsed.success).toBe(true);
  });

  it('validates outcome evidence', () => {
    const validEvidence = {
      schema_version: OUTCOME_EVIDENCE_SCHEMA_VERSION,
      task_id: 'test-task',
      trace_id: '0123456789abcdef0123456789abcdef',
      test_status: 'passed',
      timestamp: new Date().toISOString(),
      details: {},
    };
    const parsed = OutcomeEvidenceSchema.safeParse(validEvidence);
    expect(parsed.success).toBe(true);
  });

  it('validates optimization signal', () => {
    const validSignal = {
      schema_version: OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
      signal_id: 'sig-001',
      trace_id: '0123456789abcdef0123456789abcdef',
      failure_category: 'retrieval',
      attributed_span_ids: ['0123456789abcdef'],
      confidence: 0.95,
      timestamp: new Date().toISOString(),
      metadata: {},
    };
    const parsed = OptimizationSignalSchema.safeParse(validSignal);
    expect(parsed.success).toBe(true);
  });

  it('validates config schema', () => {
    const validConfig = {
      schema_version: CONFIG_SCHEMA_VERSION,
      version: '1.0.0',
      parameters: { maxTokens: 1000 },
      updated_at: new Date().toISOString(),
    };
    const parsed = ConfigSchema.safeParse(validConfig);
    expect(parsed.success).toBe(true);
  });
});
