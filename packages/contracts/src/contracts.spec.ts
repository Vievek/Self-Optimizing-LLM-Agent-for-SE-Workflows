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
      evidence_id: 'ev_test_01',
      run_id: 'run_test_01',
      task_id: 'django__django-11099',
      trace_id: '0123456789abcdef0123456789abcdef',
      repo: 'django/django',
      base_commit: 'fb8b75e7a9b8f2d',
      outcome: {
        resolved: true,
        tests_passed: 1,
        tests_failed: 0,
        patch_applied: true,
      },
      memory_uses: [],
      failure_labels: [],
      cost: {
        tokens_in: 1500,
        tokens_out: 250,
        wall_ms: 14500,
      },
    };
    const parsed = OutcomeEvidenceSchema.safeParse(validEvidence);
    expect(parsed.success).toBe(true);
  });

  it('validates optimization signal', () => {
    const validSignal = {
      schema_version: OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
      signal_id: 'sig_test_01',
      group_id: 'grp_001',
      run_id: 'run_01',
      task_id: 'test-task',
      trace_id: '0123456789abcdef0123456789abcdef',
      failure_class: 'retrieval',
      root_cause: {
        summary: 'Retrieved context was insufficient',
        evidence_node_ids: ['node_retrieval_1'],
      },
      target: {
        axis: 'retrieval',
        config_path: 'retrieval.top_k',
        affected_subtask: 'context_retrieval',
      },
      suggested_action: 'retrieval_param_update',
      confidence: 0.95,
      classifier: 'rule',
      config_version_at_failure: 'cfg_0001',
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
        default_tier: 'slm' as const,
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
