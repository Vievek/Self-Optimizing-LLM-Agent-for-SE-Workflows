import type { FullAgentConfig, OptimizationSignal } from '@soa/contracts';
import type { AxisOptimizer } from './axis-optimizer.js';

export class RoutingOptimizer implements AxisOptimizer {
  readonly axis = 'routing' as const;

  apply(signal: OptimizationSignal, current: FullAgentConfig): FullAgentConfig | null {
    if (signal.target.axis !== this.axis) return null;

    const cloned = structuredClone(current);
    if (signal.suggested_action === 'routing_threshold_update') {
      cloned.routing.small_tier_threshold = Math.max(0.1, cloned.routing.small_tier_threshold - 0.05);
    }

    return cloned;
  }
}
