import { describe, it, expect, beforeEach } from 'vitest';
import { FullAgentConfigSchema } from '@soa/contracts';
import { MockLlmProvider } from '@soa/mocks';
import { MemoryStore } from '@soa/store';
import {
  ConfigStore,
  SignalIntake,
  ConfigValidator,
  OptimizationOrchestrator,
  PromptOptimizer,
  ToolOptimizer,
  PlanningOptimizer,
  WorkflowOptimizer,
  RetrievalOptimizer,
  RoutingOptimizer,
  BASE_CONFIG,
  SAMPLE_SIGNAL,
  runSimulatedTasks,
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

    it('loads the validated JSON default config fixture', async () => {
      const store = await ConfigStore.create();
      const config = await store.load();

      expect(FullAgentConfigSchema.safeParse(config).success).toBe(true);
      expect(config).toEqual(BASE_CONFIG);
    });

    it('persists the active version and rollback across store instances', async () => {
      const storage = new MemoryStore();
      const first = await ConfigStore.create({ store: storage, configDir: 'config' });
      const next = structuredClone(BASE_CONFIG);
      next.config_version = 'cfg_0002';
      next.retrieval.top_k = 8;
      await first.saveVersion(next);

      const restarted = await ConfigStore.create({ store: storage, configDir: 'config' });
      expect((await restarted.load()).config_version).toBe('cfg_0002');
      expect((await restarted.load()).retrieval.top_k).toBe(8);

      await restarted.activateVersion('cfg_0001');
      const afterRollback = await ConfigStore.create({ store: storage, configDir: 'config' });
      expect((await afterRollback.load()).config_version).toBe('cfg_0001');
      expect((await afterRollback.load()).retrieval.top_k).toBe(5);
    });

    it('does not reuse version numbers after restart and rollback', async () => {
      const storage = new MemoryStore();
      const first = await ConfigStore.create({ store: storage, configDir: 'config' });
      const second = structuredClone(BASE_CONFIG);
      second.config_version = 'cfg_0002';
      await first.saveVersion(second);

      const third = structuredClone(BASE_CONFIG);
      third.config_version = 'cfg_0003';
      await first.saveVersion(third);
      await first.activateVersion('cfg_0001');

      const restarted = await ConfigStore.create({ store: storage, configDir: 'config' });
      expect(restarted.getNextVersionId()).toBe('cfg_0004');
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

    it('rejects unknown nested configuration paths', () => {
      const res = validator.validateCandidate(BASE_CONFIG, 'retrieval.not_a_field', 123);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Unknown configuration path');
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

  describe('OptimizationOrchestrator Pipeline (End-to-End)', () => {
    let orch: OptimizationOrchestrator;
    let mockLlm: MockLlmProvider;

    beforeEach(() => {
      mockLlm = new MockLlmProvider();
      orch = new OptimizationOrchestrator({
        llmProvider: mockLlm,
      });
    });

    it('processes a valid signal, produces cfg_0002, and subsequent load() returns it without restart', async () => {
      const initialVer = orch.configStore.getActiveVersion();
      expect(initialVer).toBe('cfg_0001');

      const signal = structuredClone(SAMPLE_SIGNAL);
      signal.target.axis = 'retrieval';
      signal.target.config_path = 'retrieval.top_k';
      signal.suggested_action = 'retrieval_param_update';

      const result = await orch.processSignal(signal);
      expect(result.status).toBe('deployed');
      expect(result.newVersion).toBe('cfg_0002');

      // Immediate load without restart returns new version
      const active = await orch.load();
      expect(active.config_version).toBe('cfg_0002');
      expect(active.retrieval.top_k).toBe(6);

      // Audit entry recorded
      const audit = await orch.auditLogger.query({ signal_id: signal.signal_id });
      expect(audit.length).toBe(1);
      expect(audit[0]?.action).toBe('deploy');
      expect(audit[0]?.version_after).toBe('cfg_0002');
    });

    it('enforces stability control: at most one change per signal group_id', async () => {
      const signal1 = structuredClone(SAMPLE_SIGNAL);
      signal1.group_id = 'grp_duplicate_test';
      signal1.signal_id = 'sig_test_1';
      signal1.target.axis = 'retrieval';
      signal1.target.config_path = 'retrieval.top_k';
      signal1.suggested_action = 'retrieval_param_update';

      const res1 = await orch.processSignal(signal1);
      expect(res1.status).toBe('deployed');

      const signal2 = structuredClone(SAMPLE_SIGNAL);
      signal2.group_id = 'grp_duplicate_test'; // Same group_id
      signal2.signal_id = 'sig_test_2';
      signal2.target.axis = 'retrieval';
      signal2.target.config_path = 'retrieval.top_k';
      signal2.suggested_action = 'retrieval_param_update';

      const res2 = await orch.processSignal(signal2);
      expect(res2.status).toBe('rejected');
      expect(res2.reason).toContain('has already produced a configuration update');
    });

    it('performs rollback and restores exact earlier configuration', async () => {
      // Step 1: deploy cfg_0002
      const signal = structuredClone(SAMPLE_SIGNAL);
      signal.target.axis = 'retrieval';
      signal.target.config_path = 'retrieval.top_k';
      signal.suggested_action = 'retrieval_param_update';
      await orch.processSignal(signal);

      expect(orch.configStore.getActiveVersion()).toBe('cfg_0002');

      // Step 2: rollback to cfg_0001
      const rolledBack = await orch.rollback('cfg_0001', 'Test rollback');
      expect(rolledBack.config_version).toBe('cfg_0001');
      expect(orch.configStore.getActiveVersion()).toBe('cfg_0001');

      const active = await orch.load();
      expect(active.config_version).toBe('cfg_0001');
      expect(active.retrieval.top_k).toBe(5);

      const audit = await orch.auditLogger.query({ action: 'rollback' });
      expect(audit.length).toBe(1);
      expect(audit[0]?.version_after).toBe('cfg_0001');
    });

    it('deploys an LLM-generated retrieval.top_k value', async () => {
      mockLlm.registerCanned(
        /Current Value:\s*5/,
        JSON.stringify({
          proposedValue: 8,
          rationale: 'Increase retrieval recall',
        }),
      );

      const signal = structuredClone(SAMPLE_SIGNAL);
      signal.signal_id = 'sig_llm_top_k';
      signal.group_id = 'grp_llm_top_k';
      signal.classifier = 'llm_judge';
      signal.target.axis = 'retrieval';
      signal.target.config_path = 'retrieval.top_k';

      const result = await orch.processSignal(signal);

      expect(result.status).toBe('deployed');
      expect(result.config?.retrieval.top_k).toBe(8);

      const active = await orch.load();
      expect(active.retrieval.top_k).toBe(8);
    });

    it('rejects an invalid LLM-generated retrieval.top_k value', async () => {
      mockLlm.registerCanned(
        /Current Value:\s*5/,
        JSON.stringify({
          proposedValue: 99,
          rationale: 'Test out-of-range value',
        }),
      );

      const signal = structuredClone(SAMPLE_SIGNAL);
      signal.signal_id = 'sig_llm_invalid_top_k';
      signal.group_id = 'grp_llm_invalid_top_k';
      signal.classifier = 'llm_judge';
      signal.target.axis = 'retrieval';
      signal.target.config_path = 'retrieval.top_k';

      const result = await orch.processSignal(signal);

      expect(result.status).toBe('rejected');
      expect(result.validation?.valid).toBe(false);

      const active = await orch.load();
      expect(active.retrieval.top_k).toBe(5);
    });

    it('automatically rolls back after five consecutive failures', async () => {
      // Deploy cfg_0002.
      const signal = structuredClone(SAMPLE_SIGNAL);
      signal.signal_id = 'sig_auto_rollback';
      signal.group_id = 'grp_auto_rollback';
      signal.target.axis = 'retrieval';
      signal.target.config_path = 'retrieval.top_k';
      signal.suggested_action = 'retrieval_param_update';

      const result = await orch.processSignal(signal);

      expect(result.status).toBe('deployed');
      expect(orch.configStore.getActiveVersion()).toBe('cfg_0002');

      // Record five failed task outcomes against the active version.
      let rolledBackTo: string | null = null;

      for (let i = 0; i < 5; i++) {
        rolledBackTo = await orch.recordTaskOutcome(i, false);
      }

      expect(rolledBackTo).toBe('cfg_0001');
      expect(orch.configStore.getActiveVersion()).toBe('cfg_0001');

      const active = await orch.load();
      expect(active.retrieval.top_k).toBe(5);

      const audit = await orch.auditLogger.query({ action: 'rollback' });
      expect(
        audit.some(
          (entry) => entry.version_after === 'cfg_0001' && entry.reason === 'regression_window',
        ),
      ).toBe(true);
    });

    it('does not roll back for a mixed-success metric window', async () => {
      // Deploy cfg_0002.
      const signal = structuredClone(SAMPLE_SIGNAL);
      signal.signal_id = 'sig_mixed_outcomes';
      signal.group_id = 'grp_mixed_outcomes';
      signal.target.axis = 'retrieval';
      signal.target.config_path = 'retrieval.top_k';
      signal.suggested_action = 'retrieval_param_update';

      const result = await orch.processSignal(signal);

      expect(result.status).toBe('deployed');
      expect(orch.configStore.getActiveVersion()).toBe('cfg_0002');

      // Record mixed outcomes. Keep the failure rate below 50%.
      const outcomes = [false, true, false, true, true];

      for (let i = 0; i < outcomes.length; i++) {
        const rolledBackTo = await orch.recordTaskOutcome(i, outcomes[i]!);
        expect(rolledBackTo).toBeNull();
      }

      expect(orch.configStore.getActiveVersion()).toBe('cfg_0002');

      const audit = await orch.auditLogger.query({ action: 'rollback' });
      expect(audit).toHaveLength(0);
    });
  });

  describe('Simulated Run Evaluator Stub', () => {
    let orch: OptimizationOrchestrator;
    let mockLlm: MockLlmProvider;

    beforeEach(() => {
      mockLlm = new MockLlmProvider();
      orch = new OptimizationOrchestrator({
        llmProvider: mockLlm,
      });
    });

    it('runs a baseline and returns finite metrics', async () => {
      const res = await runSimulatedTasks({
        taskCount: 20,
        orchOff: true,
      });

      expect(res.outcomes).toHaveLength(20);
      expect(res.outcomes[0]).toMatchObject({
        taskIndex: 0,
        taskId: 'sim_000',
        success: true,
        tokens: 100,
        rolledBack: false,
      });

      expect(Object.values(res.metrics).every(Number.isFinite)).toBe(true);
      expect(res.metrics.successRateDelta).toBe(0);
    });

    it('records task outcomes and triggers automatic rollback', async () => {
      const signal = structuredClone(SAMPLE_SIGNAL);
      signal.signal_id = 'sig_eval_rollback';
      signal.group_id = 'grp_eval_rollback';
      signal.target.axis = 'retrieval';
      signal.target.config_path = 'retrieval.top_k';
      signal.suggested_action = 'retrieval_param_update';

      const deployed = await orch.processSignal(signal);
      expect(deployed.status).toBe('deployed');
      expect(orch.configStore.getActiveVersion()).toBe('cfg_0002');

      const result = await runSimulatedTasks({
        taskCount: 5,
        orchestrator: orch,
      });

      expect(result.outcomes).toHaveLength(5);
      expect(result.outcomes.every((outcome) => !outcome.success)).toBe(true);
      expect(orch.configStore.getActiveVersion()).toBe('cfg_0001');
      expect(result.outcomes.some((outcome) => outcome.rolledBack)).toBe(true);
    });

    it('loads the default config and creates cfg_0001 when no options are provided', async () => {
      const store = new ConfigStore();

      const config = await store.load();

      expect(config.config_version).toBe('cfg_0001');
      expect(() => FullAgentConfigSchema.parse(config)).not.toThrow();
      expect(config).toEqual(BASE_CONFIG);
    });
  });
});
