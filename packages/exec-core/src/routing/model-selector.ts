import {
  RoutingConfig,
  CONFIG_SCHEMA_VERSION,
  RouteSpanAttributesSchema,
} from '@soa/contracts';
import { z } from 'zod';
import {
  SubtaskRoutingFeatures,
  SubtaskRoutingFeaturesSchema,
  RoutingDecision,
  ScoringWeights,
} from './types.js';
import { calculateRoutingScore, DEFAULT_SCORING_WEIGHTS } from './scoring-rule.js';

export type RouteSpanAttributes = z.infer<typeof RouteSpanAttributesSchema>;

export interface ModelSelectorOptions {
  config?: Partial<RoutingConfig>;
  weights?: ScoringWeights;
  slmModel?: string;
  llmModel?: string;
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

  constructor(options: ModelSelectorOptions = {}) {
    this.config = {
      ...DEFAULT_ROUTING_CONFIG,
      ...options.config,
    };
    this.weights = options.weights ?? DEFAULT_SCORING_WEIGHTS;
    this.slmModel = options.slmModel ?? 'Qwen/Qwen2.5-Coder-7B-Instruct';
    this.llmModel = options.llmModel ?? 'Qwen/Qwen2.5-Coder-32B-Instruct';
  }

  /**
   * Deterministically assigns a subtask to either the small model tier (SLM)
   * or large model tier (LLM) based on quantifiable input features.
   */
  selectTier(rawFeatures: unknown): RoutingDecision {
    const features = SubtaskRoutingFeaturesSchema.parse(rawFeatures);
    const { score, reasoning } = calculateRoutingScore(features, this.weights);

    // Scoring <= threshold qualifies for SLM tier; higher scores escalate to LLM tier
    const isSmallTier = score <= this.config.small_tier_threshold;
    const tier = isSmallTier ? 'slm' : 'llm';
    const model = isSmallTier ? this.slmModel : this.llmModel;

    return {
      tier,
      model,
      score,
      features,
      reasoning: `Decision: ${tier.toUpperCase()} (${model}) | Threshold: ${this.config.small_tier_threshold} | ${reasoning}`,
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

