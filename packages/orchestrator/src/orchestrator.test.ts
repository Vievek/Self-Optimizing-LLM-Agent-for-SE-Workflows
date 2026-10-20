import { describe, it, expect } from 'vitest';
import { FullAgentConfigSchema } from '@soa/contracts';
import {
  ConfigStore,
  SignalIntake,
  ConfigValidator,
  PromptOptimizer,
  ToolOptimizer,
  PlanningOptimizer,
  WorkflowOptimizer,
  RetrievalOptimizer,
  RoutingOptimizer,
  BASE_CONFIG,
  SAMPLE_SIGNAL,
} from './index.js';

describe('Optimization Orchestrator Skeleton Tests', () => {
  describe('ConfigStore (FR4)', () => {
    it('initializes with valid BASE_CONFIG adhering to FullAgentConfigSchema', async () => {
      const store = new ConfigStore();
      const cfg = await store.load();

      expect(cfg.config_version).toBe('cfg_0001');
      expect(FullAgentConfigSchema.safeParse(cfg).success).toBe(true);
      expect(cfg.retrieval.top_k).toBe(5);
    });

    it('saves a new version and updates active version', async () => {
      const store = new ConfigStore();
      const nextVer = store.getNextVersionId();
      expect(nextVer).toBe('cfg_0002');

      const updated = structuredClone(BASE_CONFIG);
      updated.config_version = nextVer;
      updated.retrieval.top_k = 7;

      await store.saveVersion(updated);
      expect(store.getActiveVersion()).toBe('cfg_0002');

      const loaded = await store.load();
      expect(loaded.retrieval.top_k).toBe(7);

      const oldVersion = await store.load('cfg_0001');
      expect(oldVersion.retrieval.top_k).toBe(5);
    });

    it('rejects saving config that violates schema', async () => {
      const store = new ConfigStore();
      const bad = structuredClone(BASE_CONFIG) as Record<string, unknown>;
      bad.config_version = 'not_a_valid_version';
      await expect(store.saveVersion(bad as typeof BASE_CONFIG)).rejects.toThrow();
    });
  });

  describe('SignalIntake (FR1)', () => {
    it('accepts schema-valid OptimizationSignal', () => {
      const intake = new SignalIntake();
      const result = intake.processBatch([SAMPLE_SIGNAL]);
      expect(result.valid.length).toBe(1);
      expect(result.dropped.length).toBe(0);
      expect(result.valid[0]?.signal_id).toBe(SAMPLE_SIGNAL.signal_id);
    });

    it('drops invalid signals with a logged reason', () => {
      const intake = new SignalIntake();
      const invalidSignal = {
        signal_id: 'bad_prefix',
        schema_version: '2.0',
      };
      const result = intake.processBatch([invalidSignal]);
      expect(result.valid.length).toBe(0);
      expect(result.dropped.length).toBe(1);
      expect(result.dropped[0]?.reason).toBeTruthy();
    });
  });

  describe('Validation & Range Checks (FR3)', () => {
    const validator = new ConfigValidator();

    it('accepts valid in-range updates', () => {
      const res = validator.validateCandidate(BASE_CONFIG, 'retrieval.top_k', 8);
      expect(res.valid).toBe(true);
      expect(res.config?.retrieval.top_k).toBe(8);
      expect(res.oldValue).toBe(5);
      expect(res.newValue).toBe(8);
    });

    it('rejects out-of-range top_k (greater than 20)', () => {
      const res = validator.validateCandidate(BASE_CONFIG, 'retrieval.top_k', 99);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('retrieval.top_k must be an integer between 1 and 20');
    });

    it('rejects unknown root axes', () => {
      const res = validator.validateCandidate(BASE_CONFIG, 'unknown_axis.param', 123);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Unknown configuration path axis');
    });
  });

  describe('Axis Optimizers (FR10–FR12)', () => {
    it('ToolOptimizer adjusts tool description on tool_description_refine', () => {
      const opt = new ToolOptimizer();
      const signal = structuredClone(SAMPLE_SIGNAL);
      signal.target.axis = 'tool';
      signal.target.config_path = 'tools.apply_patch.description';
      signal.suggested_action = 'tool_description_refine';
      signal.root_cause.summary = 'Patch format requires relative path';

      const res = opt.apply(signal, BASE_CONFIG);
      expect(res).not.toBeNull();
      expect(res?.tools.tools['apply_patch']?.description).toContain(
        'Patch format requires relative path',
      );
    });

    it('RetrievalOptimizer increments top_k within bounds', () => {
      const opt = new RetrievalOptimizer();
      const signal = structuredClone(SAMPLE_SIGNAL);
      signal.target.axis = 'retrieval';
      signal.target.config_path = 'retrieval.top_k';
      signal.suggested_action = 'retrieval_param_update';

      const res = opt.apply(signal, BASE_CONFIG);
      expect(res).not.toBeNull();
      expect(res?.retrieval.top_k).toBe(6);
    });

    it('PlanningOptimizer increments backtrack_depth within bounds', () => {
      const opt = new PlanningOptimizer();
      const signal = structuredClone(SAMPLE_SIGNAL);
      signal.target.axis = 'planning';
      signal.target.config_path = 'planning.backtrack_depth';
      signal.suggested_action = 'planning_param_update';

      const res = opt.apply(signal, BASE_CONFIG);
      expect(res).not.toBeNull();
      expect(res?.planning.backtrack_depth).toBe(3);
    });

    it('WorkflowOptimizer increments max_iterations within bounds', () => {
      const opt = new WorkflowOptimizer();
      const signal = structuredClone(SAMPLE_SIGNAL);
      signal.target.axis = 'workflow';
      signal.target.config_path = 'workflow.max_iterations';
      signal.suggested_action = 'workflow_param_update';

      const res = opt.apply(signal, BASE_CONFIG);
      expect(res).not.toBeNull();
      expect(res?.workflow.max_iterations).toBe(12);
    });

    it('RoutingOptimizer adjusts small_tier_threshold', () => {
      const opt = new RoutingOptimizer();
      const signal = structuredClone(SAMPLE_SIGNAL);
      signal.target.axis = 'routing';
      signal.target.config_path = 'routing.small_tier_threshold';
      signal.suggested_action = 'routing_threshold_update';

      const res = opt.apply(signal, BASE_CONFIG);
      expect(res).not.toBeNull();
      expect(res?.routing.small_tier_threshold).toBeCloseTo(0.7);
    });

    it('PromptOptimizer updates prompt version', () => {
      const opt = new PromptOptimizer();
      const signal = structuredClone(SAMPLE_SIGNAL);
      signal.target.axis = 'prompt';
      signal.target.config_path = 'prompts.system_prompt_version';
      signal.target.affected_subtask = '';

      const res = opt.apply(signal, BASE_CONFIG);
      expect(res).not.toBeNull();
      expect(res?.prompts.system_prompt_version).toBe('1.0_opt');
    });
  });
});
