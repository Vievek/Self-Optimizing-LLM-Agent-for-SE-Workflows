import { describe, it, expect } from 'vitest';
import {
  TraceSpanSchema,
  TypedTraceSpanSchema,
  OptimizationSignalSchema,
  RefinedMemorySchema,
  FullAgentConfigSchema,
  CONFIG_SCHEMA_VERSION,
  type FullAgentConfig,
  type OutcomeEvidence,
} from '@soa/contracts';
import {
  MockExecCore,
  MockHeae,
  MockMemoryAgent,
  MockOrchestrator,
  MockLlmProvider,
} from './index.js';

describe('CI Mock Contract Validation Tests', () => {
  it('validates MockExecCore spans against TraceSpanSchema and TypedTraceSpanSchema', async () => {
    const exec = new MockExecCore();
    const result = await exec.runTask('django__django-11099');

    expect(result.spans.length).toBeGreaterThan(0);

    for (const span of result.spans) {
      const traceParsed = TraceSpanSchema.safeParse(span);
      expect(traceParsed.success).toBe(true);

      const typedParsed = TypedTraceSpanSchema.safeParse(span);
      expect(typedParsed.success).toBe(true);
    }

    const outputSpan = result.spans.find((s) => s.name === 'output');
    expect(outputSpan).toBeDefined();
    expect(outputSpan?.attributes['tests_passed']).toBeDefined();
    expect(outputSpan?.attributes['tests_failed']).toBeDefined();

    const retrievalSpan = result.spans.find((s) => s.name === 'retrieval');
    expect(retrievalSpan).toBeDefined();
    expect(retrievalSpan?.attributes['source']).toBe('memory');
  });

  it('validates MockHeae signals against OptimizationSignalSchema', async () => {
    const heae = new MockHeae();
    const mockEvidence: OutcomeEvidence = {
      schema_version: '2.0',
      evidence_id: 'ev_01J9X8ABCDEF0123456789ABCD',
      run_id: 'run_20261015T1000_baseline_01',
      task_id: 'django__django-11099',
      trace_id: '0123456789abcdef0123456789abcdef',
      repo: 'django/django',
      base_commit: 'fb8b75e7a9b8f2d',
      outcome: {
        resolved: false,
        tests_passed: 4,
        tests_failed: 1,
        patch_applied: true,
      },
      memory_uses: [],
      failure_labels: [{ class: 'tool', node_ids: ['tool_call_node_1'], confidence: 0.9 }],
      cost: { tokens_in: 100, tokens_out: 50, wall_ms: 1200 },
    };

    const signals = await heae.evaluateAndAttribute(mockEvidence, []);
    expect(signals.length).toBeGreaterThan(0);

    for (const signal of signals) {
      const parsed = OptimizationSignalSchema.safeParse(signal);
      expect(parsed.success).toBe(true);
      // Ensure config_path is not a made-up value
      expect(signal.target.config_path.startsWith('tools.')).toBe(true);
    }
  });

  it('validates MockMemoryAgent output against RefinedMemorySchema and accepts consolidate', async () => {
    const mem = new MockMemoryAgent();
    const notes = await mem.retrieve('regex validation', 'django/django', 'fb8b75e7a9b8f2d');
    expect(notes.length).toBeGreaterThan(0);

    for (const note of notes) {
      const parsed = RefinedMemorySchema.safeParse(note);
      expect(parsed.success).toBe(true);
      expect(note.action).toBe('KEEP');
      expect(note.lifecycle).toBe('active');
    }

    await mem.consolidate({
      taskId: 'django__django-11099',
      repo: 'django/django',
      baseCommit: 'fb8b75e7a9b8f2d',
      resolved: true,
      notes: ['Fixed trailing newline in regex validator'],
    });

    expect(mem.consolidatedSummaries.length).toBe(1);
    expect(mem.consolidatedSummaries[0]?.resolved).toBe(true);
  });

  it('validates MockOrchestrator output against FullAgentConfigSchema and bumps version', async () => {
    const orch = new MockOrchestrator();
    const baseConfig: FullAgentConfig = {
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
          default: { id: 'default', version: '1.0', template: 'instruction' },
        },
      },
      tools: {
        schema_version: CONFIG_SCHEMA_VERSION,
        tools: {
          apply_patch: {
            name: 'apply_patch',
            description: 'Apply unified git diff',
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

    const signal = {
      schema_version: '2.0' as const,
      signal_id: 'sig_01_django__django-11099_01',
      group_id: 'grp_01',
      run_id: 'run_01',
      task_id: 'django__django-11099',
      trace_id: '0123456789abcdef0123456789abcdef',
      failure_class: 'tool' as const,
      root_cause: { summary: 'Tool description mismatch', evidence_node_ids: [] },
      target: {
        axis: 'tool' as const,
        config_path: 'tools.apply_patch.description',
        affected_subtask: 'patching',
      },
      suggested_action: 'tool_description_refine' as const,
      confidence: 0.9,
      classifier: 'rule' as const,
      config_version_at_failure: 'cfg_0001',
    };

    const updated = await orch.optimizeFullConfig(signal, baseConfig);
    const parsed = FullAgentConfigSchema.safeParse(updated);
    expect(parsed.success).toBe(true);
    expect(updated.config_version).toBe('cfg_0002');
    expect(updated.tools.tools['apply_patch']?.description).toContain('(refined)');
  });

  it('validates MockLlmProvider canned response mechanism', async () => {
    const llm = new MockLlmProvider();
    llm.registerCanned('test prompt', 'Canned answer');

    const res = await llm.chat({
      model: 'qwen',
      messages: [{ role: 'user', content: 'Here is a test prompt' }],
    });
    expect(res.content).toBe('Canned answer');
    expect(res.provider).toBe('mock');
  });
});
