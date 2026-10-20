import type { FullAgentConfig, OptimizationSignal, OptimizationTargetAxis } from '@soa/contracts';

/**
 * Shared contract for every axis optimizer.
 *
 * Implementations must return a cloned FullAgentConfig or null when the
 * signal is not theirs. They must not mutate `current` and must not call
 * a model API directly — LLM work goes through FixGenerator / LlmProvider.
 */
export interface AxisOptimizer {
  readonly axis: OptimizationTargetAxis;
  apply(signal: OptimizationSignal, current: FullAgentConfig): FullAgentConfig | null;
}
