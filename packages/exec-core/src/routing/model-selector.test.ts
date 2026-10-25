import { describe, it, expect } from 'vitest';
import { RouteSpanAttributesSchema } from '@soa/contracts';
import { ModelSelector } from './model-selector.js';
import { SubtaskRoutingFeatures } from './types.js';

describe('ModelSelector (Model Selection Module)', () => {
  const selector = new ModelSelector();

  it('is strictly deterministic: identical inputs yield identical score and tier across runs', () => {
    const features: SubtaskRoutingFeatures = {
      step_type: 'localize',
      estimated_tokens: 1800,
      file_count: 1,
      prior_failures: 0,
      requires_cross_file_reasoning: false,
      symbol_count: 2,
    };

    const first = selector.selectTier(features);

    for (let i = 0; i < 50; i++) {
      const result = selector.selectTier(features);
      expect(result.score).toBe(first.score);
      expect(result.tier).toBe(first.tier);
      expect(result.model).toBe(first.model);
    }
  });

  it('routes well-scoped exploration tasks to SLM (small tier)', () => {
    const features: SubtaskRoutingFeatures = {
      step_type: 'explore',
      estimated_tokens: 500,
      file_count: 1,
      prior_failures: 0,
      requires_cross_file_reasoning: false,
      symbol_count: 1,
    };

    const decision = selector.selectTier(features);
    expect(decision.tier).toBe('slm');
    expect(decision.score).toBeLessThanOrEqual(0.4);
    expect(decision.model).toContain('7B');
  });

  it('routes test execution tasks to SLM', () => {
    const features: SubtaskRoutingFeatures = {
      step_type: 'test',
      estimated_tokens: 1200,
      file_count: 1,
      prior_failures: 0,
      requires_cross_file_reasoning: false,
      symbol_count: 1,
    };

    const decision = selector.selectTier(features);
    expect(decision.tier).toBe('slm');
    expect(decision.score).toBeLessThanOrEqual(0.4);
  });

  it('routes high-context multi-file edits to LLM (large tier)', () => {
    const features: SubtaskRoutingFeatures = {
      step_type: 'edit_multi_file',
      estimated_tokens: 6500,
      file_count: 4,
      prior_failures: 0,
      requires_cross_file_reasoning: true,
      symbol_count: 8,
    };

    const decision = selector.selectTier(features);
    expect(decision.tier).toBe('llm');
    expect(decision.score).toBeGreaterThan(0.4);
    expect(decision.model).toContain('32B');
  });

  it('routes architectural planning subtasks to LLM', () => {
    const features: SubtaskRoutingFeatures = {
      step_type: 'plan',
      estimated_tokens: 3000,
      file_count: 2,
      prior_failures: 0,
      requires_cross_file_reasoning: true,
      symbol_count: 4,
    };

    const decision = selector.selectTier(features);
    expect(decision.tier).toBe('llm');
    expect(decision.score).toBeGreaterThan(0.4);
  });

  it('escalates simple subtasks to LLM after repeated failures', () => {
    const baseFeatures: SubtaskRoutingFeatures = {
      step_type: 'edit_single_file',
      estimated_tokens: 1500,
      file_count: 1,
      prior_failures: 0,
      requires_cross_file_reasoning: false,
      symbol_count: 1,
    };

    const initial = selector.selectTier(baseFeatures);
    expect(initial.tier).toBe('slm');

    // After 2 prior failures, the failure penalty escalates the task to LLM
    const failedTwice = selector.selectTier({
      ...baseFeatures,
      prior_failures: 2,
    });

    expect(failedTwice.score).toBeGreaterThan(initial.score);
    expect(failedTwice.tier).toBe('llm');
  });

  it('respects dynamic configuration updates from Optimization Orchestrator', () => {
    const dynamicSelector = new ModelSelector();

    const features: SubtaskRoutingFeatures = {
      step_type: 'localize',
      estimated_tokens: 4000,
      file_count: 2,
      prior_failures: 0,
      requires_cross_file_reasoning: false,
      symbol_count: 2,
    };

    // With default threshold (0.40)
    const initial = dynamicSelector.selectTier(features);
    expect(initial.tier).toBe('slm');

    // Orchestrator lowers threshold to 0.20 (more aggressive escalation)
    dynamicSelector.updateConfig({ small_tier_threshold: 0.2 });
    const afterUpdate = dynamicSelector.selectTier(features);
    expect(afterUpdate.tier).toBe('llm');
  });

  it('generates valid RouteSpanAttributes conforming to shared contracts', () => {
    const features: SubtaskRoutingFeatures = {
      step_type: 'localize',
      estimated_tokens: 1500,
      file_count: 1,
      prior_failures: 0,
      requires_cross_file_reasoning: false,
      symbol_count: 2,
    };

    const decision = selector.selectTier(features);
    const spanAttrs = selector.createRouteSpanAttributes(decision);

    // Strict validation against Zod schema from @soa/contracts
    const validated = RouteSpanAttributesSchema.parse(spanAttrs);
    expect(validated.tier).toBe(decision.tier);
    expect(validated.model).toBe(decision.model);
    expect(validated.score).toBe(decision.score);
    expect(validated.features).toBeDefined();
  });

  it('validates input features and rejects invalid types', () => {
    expect(() => {
      selector.selectTier({
        step_type: 'invalid_step_type',
      });
    }).toThrow();
  });

  describe('Role Hierarchy Routing Rule Method (Decision-Making -> LLM, Code Generation -> SLM)', () => {
    const roleSelector = new ModelSelector({ routingRule: 'role_hierarchy' });

    it('routes decision-making, planning, batch edits, and multi-file steps to LLM', () => {
      const locDecision = roleSelector.selectTier({
        step_type: 'localize',
        estimated_tokens: 700,
        file_count: 2,
        prior_failures: 0,
        requires_cross_file_reasoning: true,
        symbol_count: 2,
      });
      expect(locDecision.tier).toBe('llm');
      expect(locDecision.reasoning).toContain('High-reasoning step');

      const planDecision = roleSelector.selectTier({
        step_type: 'plan',
        estimated_tokens: 500,
        file_count: 1,
        prior_failures: 0,
        requires_cross_file_reasoning: false,
        symbol_count: 1,
      });
      expect(planDecision.tier).toBe('llm');

      // Batch / multi-file edit -> LLM
      const multiEditDecision = roleSelector.selectTier({
        step_type: 'edit_multi_file',
        estimated_tokens: 1500,
        file_count: 2,
        prior_failures: 0,
        requires_cross_file_reasoning: true,
        symbol_count: 3,
      });
      expect(multiEditDecision.tier).toBe('llm');
    });

    it('routes low-complexity tactical single-file steps (edit_single_file, test, explore) to SLM', () => {
      // Single-file targeted surgical patch with score <= small_tier_threshold -> SLM
      const editDecision = roleSelector.selectTier({
        step_type: 'edit_single_file',
        estimated_tokens: 800,
        file_count: 1,
        prior_failures: 0,
        requires_cross_file_reasoning: false,
        symbol_count: 1,
      });
      expect(editDecision.tier).toBe('slm');
      expect(editDecision.reasoning).toContain('Tactical execution step (edit_single_file');

      // Single-file layout explore -> SLM
      const exploreDecision = roleSelector.selectTier({
        step_type: 'explore',
        estimated_tokens: 500,
        file_count: 1,
        prior_failures: 0,
        requires_cross_file_reasoning: false,
        symbol_count: 1,
      });
      expect(exploreDecision.tier).toBe('slm');
      expect(exploreDecision.reasoning).toContain('Tactical execution step (explore');

      const testDecision = roleSelector.selectTier({
        step_type: 'test',
        estimated_tokens: 800,
        file_count: 1,
        prior_failures: 0,
        requires_cross_file_reasoning: false,
        symbol_count: 1,
      });
      expect(testDecision.tier).toBe('slm');
    });

    it('escalates code generation to LLM when prior failures reach threshold', () => {
      const failedEdit = roleSelector.selectTier({
        step_type: 'edit_single_file',
        estimated_tokens: 800,
        file_count: 1,
        prior_failures: 2,
        requires_cross_file_reasoning: false,
        symbol_count: 1,
      });
      expect(failedEdit.tier).toBe('llm');
      expect(failedEdit.reasoning).toContain('Escalated to LLM due to 2 prior failures');
    });
  });
});
