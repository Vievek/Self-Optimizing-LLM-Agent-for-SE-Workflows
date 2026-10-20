import { SubtaskRoutingFeatures, SubtaskType, ScoringWeights } from './types.js';

export const STEP_COMPLEXITY_MAP: Record<SubtaskType, number> = {
  explore: 0.1,
  test: 0.18,
  localize: 0.28,
  edit_single_file: 0.42,
  edit_multi_file: 0.78,
  plan: 0.82,
  replan: 0.88,
};

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  stepComplexity: 0.4,
  contextRatio: 0.2,
  crossFile: 0.15,
  priorFailures: 0.25,
};

/**
 * Deterministic scoring rule for software engineering sub-tasks.
 * Returns a score between 0.0 and 1.0.
 * Lower scores indicate simple, well-scoped tasks suitable for SLM (small tier).
 * Higher scores indicate complex, high-context, or retry-heavy tasks requiring LLM (large tier).
 */
export function calculateRoutingScore(
  features: SubtaskRoutingFeatures,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): { score: number; reasoning: string } {
  const stepScore = STEP_COMPLEXITY_MAP[features.step_type] ?? 0.5;

  // Context ratio normalized to 8000 tokens (SLM sweet spot)
  const contextRatio = Math.min(1.0, features.estimated_tokens / 8000);

  // Cross-file complexity
  let crossFileScore = Math.min(1.0, Math.max(0, features.file_count - 1) / 3);
  if (features.requires_cross_file_reasoning) {
    crossFileScore = Math.max(crossFileScore, 0.75);
  }

  // Prior failures escalation penalty (each failure adds 0.50, ensuring 2 failures escalate to large tier)
  const failureScore = Math.min(1.0, features.prior_failures * 0.5);

  const rawScore =
    stepScore * weights.stepComplexity +
    contextRatio * weights.contextRatio +
    crossFileScore * weights.crossFile +
    failureScore * weights.priorFailures;

  // Clamp to [0.0, 1.0] and round to 4 decimal places for deterministic precision
  const finalScore = Math.min(1.0, Math.max(0.0, Math.round(rawScore * 10000) / 10000));

  const reasoning =
    `step_type=${features.step_type}(${stepScore.toFixed(2)}) * ${weights.stepComplexity} + ` +
    `context=${features.estimated_tokens}t(${contextRatio.toFixed(2)}) * ${weights.contextRatio} + ` +
    `cross_files=${features.file_count}(${crossFileScore.toFixed(2)}) * ${weights.crossFile} + ` +
    `failures=${features.prior_failures}(${failureScore.toFixed(2)}) * ${weights.priorFailures} = ${finalScore.toFixed(4)}`;

  return { score: finalScore, reasoning };
}
