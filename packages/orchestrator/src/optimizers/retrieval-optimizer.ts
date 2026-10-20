import type { FullAgentConfig, OptimizationSignal } from '@soa/contracts';
import type { AxisOptimizer } from './axis-optimizer.js';

export class RetrievalOptimizer implements AxisOptimizer {
  readonly axis = 'retrieval' as const;

  apply(signal: OptimizationSignal, current: FullAgentConfig): FullAgentConfig | null {
    if (signal.target.axis !== this.axis) return null;

    const cloned = structuredClone(current);
    if (signal.target.config_path.includes('min_score')) {
      cloned.retrieval.min_score = Math.max(0.05, cloned.retrieval.min_score - 0.05);
    } else if (signal.target.config_path.includes('max_depth')) {
      cloned.retrieval.max_depth = Math.min(5, cloned.retrieval.max_depth + 1);
    } else {
      // Default retrieval adjustment: top_k
      cloned.retrieval.top_k = Math.min(20, cloned.retrieval.top_k + 1);
    }

    return cloned;
  }
}
