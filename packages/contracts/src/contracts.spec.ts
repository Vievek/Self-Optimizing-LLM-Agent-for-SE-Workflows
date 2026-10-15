import { describe, it, expect } from 'vitest';
import {
  TraceSpanSchema,
  OutputSpanAttributesSchema,
  RouteSpanAttributesSchema,
  ModelTierSchema,
  SCHEMA_VERSION,
} from './trace.js';
import { OutcomeEvidenceSchema, OUTCOME_EVIDENCE_SCHEMA_VERSION } from './outcome-evidence.js';
import {
  OptimizationSignalSchema,
  OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
} from './optimization-signal.js';
import {
  ToolsConfigSchema,
  FullAgentConfigSchema,
  ConfigSchema,
  CONFIG_SCHEMA_VERSION,
} from './config.js';
import {
  generateUlid,
  generateMemoryId,
  generateEvidenceId,
  generateSignalId,
  generateConfigVersion,
  generateTraceId,
  generateSpanId,
  generateRunId,
  isValidMemoryId,
  isValidEvidenceId,
  isValidSignalId,
  isValidConfigVersion,
  isValidTraceId,
  isValidSpanId,
  isValidRunId,
} from './ids.js';
import { LogRecordSchema, createLogger } from './logger.js';

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

  it('validates output span with tests_passed and tests_failed', () => {
    const outputAttrs = {
      patch_hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      tests_run: 15,
      tests_passed: 12,
      tests_failed: 3,
      result: 'pass',
    };
    const parsed = OutputSpanAttributesSchema.safeParse(outputAttrs);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tests_passed).toBe(12);
      expect(parsed.data.tests_failed).toBe(3);
    }
  });

  it('defaults tests_passed and tests_failed to 0 when omitted', () => {
    const outputAttrs = {
      patch_hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      tests_run: 5,
      result: 'pass',
    };
    const parsed = OutputSpanAttributesSchema.safeParse(outputAttrs);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tests_passed).toBe(0);
      expect(parsed.data.tests_failed).toBe(0);
    }
  });

  it('enforces unified tier vocabulary (slm / llm) and rejects invalid tiers like slim', () => {
    expect(ModelTierSchema.safeParse('slm').success).toBe(true);
    expect(ModelTierSchema.safeParse('llm').success).toBe(true);
    expect(ModelTierSchema.safeParse('slim').success).toBe(false);

    const validRoute = {
      tier: 'slm',
      model: 'Qwen/Qwen2.5-Coder-7B-Instruct',
      features: {},
      score: 0.85,
    };
    expect(RouteSpanAttributesSchema.safeParse(validRoute).success).toBe(true);

    const invalidRoute = {
      tier: 'slim',
      model: 'Qwen/Qwen2.5-Coder-7B-Instruct',
      features: {},
      score: 0.85,
    };
    expect(RouteSpanAttributesSchema.safeParse(invalidRoute).success).toBe(false);
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

  it('validates tools config schema', () => {
    const validTools = {
      schema_version: CONFIG_SCHEMA_VERSION,
      tools: {
        apply_patch: {
          name: 'apply_patch',
          description: 'Applies a unified git diff patch to the workspace',
          parameters: { file: { type: 'string' } },
          timeout_s: 60,
        },
      },
    };
    const parsed = ToolsConfigSchema.safeParse(validTools);
    expect(parsed.success).toBe(true);
  });

  it('validates full agent config with tools included', () => {
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
      tools: {
        schema_version: CONFIG_SCHEMA_VERSION,
        tools: {
          apply_patch: {
            name: 'apply_patch',
            description: 'Applies patch to target repository file',
            timeout_s: 60,
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

  describe('ID Generators and Validators', () => {
    it('generates valid ULID and prefixed IDs', () => {
      const ulid = generateUlid();
      expect(ulid.length).toBe(26);

      const memId = generateMemoryId();
      expect(isValidMemoryId(memId)).toBe(true);
      expect(memId.startsWith('mem_')).toBe(true);

      const evId = generateEvidenceId();
      expect(isValidEvidenceId(evId)).toBe(true);
      expect(evId.startsWith('ev_')).toBe(true);

      const sigId1 = generateSignalId();
      expect(isValidSignalId(sigId1)).toBe(true);

      const sigId2 = generateSignalId('run_01', 'django__django-11099', 1);
      expect(isValidSignalId(sigId2)).toBe(true);
      expect(sigId2).toBe('sig_01_django__django-11099_01');

      const cfgVer = generateConfigVersion(7);
      expect(cfgVer).toBe('cfg_0007');
      expect(isValidConfigVersion(cfgVer)).toBe(true);

      const traceId = generateTraceId();
      expect(traceId.length).toBe(32);
      expect(isValidTraceId(traceId)).toBe(true);

      const spanId = generateSpanId();
      expect(spanId.length).toBe(16);
      expect(isValidSpanId(spanId)).toBe(true);

      const runId = generateRunId('baseline', 1, new Date('2026-10-15T09:00:00Z'));
      expect(runId).toBe('run_20261015T0900_baseline_01');
      expect(isValidRunId(runId)).toBe(true);
    });
  });

  describe('Pino JSON Logger', () => {
    it('creates log records matching LogRecordSchema', () => {
      const traceId = generateTraceId();
      const logger = createLogger({
        component: 'exec',
        run_id: 'run_20261015T0900_baseline_01',
        task_id: 'django__django-11099',
        trace_id: traceId,
      });
      expect(logger).toBeDefined();

      const validRecord = {
        ts: new Date().toISOString(),
        level: 'info' as const,
        component: 'exec' as const,
        run_id: 'run_20261015T0900_baseline_01',
        task_id: 'django__django-11099',
        trace_id: traceId,
        msg: 'Task started successfully',
        context: { step: 1 },
      };
      const parsed = LogRecordSchema.safeParse(validRecord);
      expect(parsed.success).toBe(true);
    });
  });
});
