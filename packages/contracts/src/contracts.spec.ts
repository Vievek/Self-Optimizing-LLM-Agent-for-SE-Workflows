import { describe, it, expect } from 'vitest';
import { TraceSpanSchema, SCHEMA_VERSION } from './trace.js';
import { OutcomeEvidenceSchema, OUTCOME_EVIDENCE_SCHEMA_VERSION } from './outcome-evidence.js';
import {
  OptimizationSignalSchema,
  OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
} from './optimization-signal.js';
import {
  PlanningConfigSchema,
  FullAgentConfigSchema,
  ConfigSchema,
  CONFIG_SCHEMA_VERSION,
} from './config.js';
import { RefinedMemorySchema, REFINED_MEMORY_SCHEMA_VERSION } from './refined-memory.js';

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

  it('validates refined memory', () => {
    const validMemory = {
      schema_version: REFINED_MEMORY_SCHEMA_VERSION,
      memory_id: 'mem-001',
      content: 'Important context',
      tags: ['doc'],
      created_at: new Date().toISOString(),
      metadata: {},
    };
    const parsed = RefinedMemorySchema.safeParse(validMemory);
    expect(parsed.success).toBe(true);
  });

  it('validates the legacy config format', () => {
    const legacyConfig = {
      schema_version: CONFIG_SCHEMA_VERSION,
      version: '1.0',
      parameters: {
        backtrack_depth: 2,
        verify_after_edit: true,
      },
      updated_at: new Date().toISOString(),
    };

    const parsed = ConfigSchema.safeParse(legacyConfig);
    expect(parsed.success).toBe(true);
  });

  it('validates planning config', () => {
  const validConfig = {
    schema_version: CONFIG_SCHEMA_VERSION,
    backtrack_depth: 2,
    verify_after_edit: true,
    subtask_timeout_s: 300,
  };

  const parsed = PlanningConfigSchema.safeParse(validConfig);
  expect(parsed.success).toBe(true);
});

it('validates full agent config', () => {
  const validConfig = {
    config_version: 'cfg_0001',
    planning: {
      schema_version: CONFIG_SCHEMA_VERSION,
      backtrack_depth: 2,
      verify_after_edit: true,
      subtask_timeout_s: 300,
    },
    prompts: {
      schema_version: CONFIG_SCHEMA_VERSION,
      system_prompt_version: '1.0',
      templates: {
        default: {
          id: 'default',
          version: '1.0',
          template: 'Review and improve the code.',
        },
      },
    },
    retrieval: {
      schema_version: CONFIG_SCHEMA_VERSION,
      top_k: 5,
      min_score: 0.7,
      hybrid_weight_vector: 0.5,
      max_depth: 2,
    },
    routing: {
      schema_version: CONFIG_SCHEMA_VERSION,
      small_tier_threshold: 0.6,
      default_tier: 'slm',
    },
    workflow: {
      schema_version: CONFIG_SCHEMA_VERSION,
      max_iterations: 10,
      retry_storm_limit: 3,
    },
  };

  const parsed = FullAgentConfigSchema.safeParse(validConfig);
  expect(parsed.success).toBe(true);
  });
});