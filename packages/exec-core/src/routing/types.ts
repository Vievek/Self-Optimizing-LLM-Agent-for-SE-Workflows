import { z } from 'zod';
import { ModelTierSchema, type ModelTier } from '@soa/contracts';

export const SubtaskTypeSchema = z.enum([
  'explore',
  'localize',
  'test',
  'edit_single_file',
  'edit_multi_file',
  'plan',
  'replan',
]);

export type SubtaskType = z.infer<typeof SubtaskTypeSchema>;

export const SubtaskRoutingFeaturesSchema = z.object({
  step_type: SubtaskTypeSchema,
  estimated_tokens: z.number().int().nonnegative().default(1000),
  file_count: z.number().int().nonnegative().default(1),
  prior_failures: z.number().int().nonnegative().default(0),
  requires_cross_file_reasoning: z.boolean().default(false),
  symbol_count: z.number().int().nonnegative().default(1),
});

export type SubtaskRoutingFeatures = z.infer<typeof SubtaskRoutingFeaturesSchema>;

export interface ScoringWeights {
  stepComplexity: number;
  contextRatio: number;
  crossFile: number;
  priorFailures: number;
}

export interface RoutingDecision {
  tier: ModelTier;
  model: string;
  score: number;
  features: SubtaskRoutingFeatures;
  reasoning: string;
}

export { ModelTierSchema, type ModelTier };

