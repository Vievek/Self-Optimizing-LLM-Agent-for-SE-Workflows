import { RoutingConfig, CONFIG_SCHEMA_VERSION, RouteSpanAttributesSchema } from '@soa/contracts';
import { z } from 'zod';
import { SubtaskRoutingFeaturesSchema, RoutingDecision, ScoringWeights } from './types.js';
import { calculateRoutingScore, DEFAULT_SCORING_WEIGHTS } from './scoring-rule.js';

export type RouteSpanAttributes = z.infer<typeof RouteSpanAttributesSchema>;

export type RoutingRuleMethod = 'complexity' | 'role_hierarchy';

export interface ModelSelectorOptions {
  config?: Partial<RoutingConfig>;
  weights?: ScoringWeights;
  slmModel?: string;
  llmModel?: string;
  routingRule?: RoutingRuleMethod;
}

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  schema_version: CONFIG_SCHEMA_VERSION,
  small_tier_threshold: 0.4,
  default_tier: 'slm',
};

export class ModelSelector {
  private config: RoutingConfig;
  private readonly weights: ScoringWeights;
  private readonly slmModel: string;
  private readonly llmModel: string;
  private readonly routingRule: RoutingRuleMethod;

  constructor(options: ModelSelectorOptions = {}) {
    this.config = {
      ...DEFAULT_ROUTING_CONFIG,
      ...options.config,
    };
    this.weights = options.weights ?? DEFAULT_SCORING_WEIGHTS;
    this.slmModel = options.slmModel ?? 'Qwen/Qwen2.5-Coder-7B-Instruct';
    this.llmModel = options.llmModel ?? 'Qwen/Qwen2.5-Coder-32B-Instruct';
    this.routingRule = options.routingRule ?? 'complexity';
  }

  /**
   * Deterministically assigns a subtask to either the small model tier (SLM)
   * or large model tier (LLM) based on quantifiable input features or role hierarchy.
   */
  selectTier(rawFeatures: unknown): RoutingDecision {
    const features = SubtaskRoutingFeaturesSchema.parse(rawFeatures);
    const { score, reasoning } = calculateRoutingScore(features, this.weights);

    let tier: 'slm' | 'llm';
    let ruleReason = '';

    if (this.routingRule === 'role_hierarchy') {
      // Escalation: Any step that has failed 2 or more times goes to LLM
      if (features.prior_failures >= 2) {
        tier = 'llm';
        ruleReason = `Role Hierarchy: Escalated to LLM due to ${features.prior_failures} prior failures`;
      }
      // Decision-making, planning, defect localization, batch edits, or multi-file context -> LLM
      else if (
        features.step_type === 'localize' ||
        features.step_type === 'plan' ||
        features.step_type === 'replan' ||
        features.step_type === 'edit_multi_file' ||
        features.requires_cross_file_reasoning ||
        features.file_count > 1 ||
        score > this.config.small_tier_threshold
      ) {
        tier = 'llm';
        ruleReason = `Role Hierarchy: High-reasoning step (${features.step_type}, files: ${features.file_count}, score: ${score.toFixed(2)}) assigned to LLM`;
      }
      // Tactical code generation and test execution -> SLM (single-file surgical edits, test runs, single recon)
      else {
        tier = 'slm';
        ruleReason = `Role Hierarchy: Tactical execution step (${features.step_type}, score: ${score.toFixed(2)}) assigned to SLM`;
      }
    } else {
      // Scoring <= threshold qualifies for SLM tier; higher scores escalate to LLM tier
      const isSmallTier = score <= this.config.small_tier_threshold;
      tier = isSmallTier ? 'slm' : 'llm';
      ruleReason = `Threshold: ${this.config.small_tier_threshold}`;
    }

    const model = tier === 'slm' ? this.slmModel : this.llmModel;

    return {
      tier,
      model,
      score,
      features,
      reasoning: `Decision: ${tier.toUpperCase()} (${model}) | ${ruleReason} | ${reasoning}`,
    };
  }

  /**
   * Produces span attributes strictly conforming to RouteSpanAttributesSchema
   * for OpenTelemetry trace emission.
   */
  createRouteSpanAttributes(decision: RoutingDecision): RouteSpanAttributes {
    const rawAttrs = {
      tier: decision.tier,
      model: decision.model,
      score: decision.score,
      features: decision.features as Record<string, unknown>,
    };

    return RouteSpanAttributesSchema.parse(rawAttrs);
  }

  /**
   * Updates configuration dynamically (e.g. when Optimization Orchestrator pushes new thresholds).
   */
  updateConfig(newConfig: Partial<RoutingConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };
  }

  getConfig(): RoutingConfig {
    return { ...this.config };
  }
}
