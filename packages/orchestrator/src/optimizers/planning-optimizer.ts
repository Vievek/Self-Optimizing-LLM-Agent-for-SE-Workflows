import type { FullAgentConfig, OptimizationSignal } from '@soa/contracts';
import type { AxisOptimizer } from './axis-optimizer.js';

export class PlanningOptimizer implements AxisOptimizer {
  readonly axis = 'planning' as const;

  apply(signal: OptimizationSignal, current: FullAgentConfig): FullAgentConfig | null {
    if (signal.target.axis !== this.axis) return null;

    const cloned = structuredClone(current);
    if (signal.suggested_action === 'planning_param_update') {
      if (signal.target.config_path.includes('backtrack_depth')) {
        cloned.planning.backtrack_depth = Math.min(5, cloned.planning.backtrack_depth + 1);
      } else if (signal.target.config_path.includes('subtask_timeout_s')) {
        cloned.planning.subtask_timeout_s = Math.min(1800, cloned.planning.subtask_timeout_s + 60);
      } else {
        cloned.planning.backtrack_depth = Math.min(5, cloned.planning.backtrack_depth + 1);
      }
    }

    return cloned;
  }
}
