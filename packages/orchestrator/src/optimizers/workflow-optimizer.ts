import type { FullAgentConfig, OptimizationSignal } from '@soa/contracts';
import type { AxisOptimizer } from './axis-optimizer.js';

export class WorkflowOptimizer implements AxisOptimizer {
  readonly axis = 'workflow' as const;

  apply(signal: OptimizationSignal, current: FullAgentConfig): FullAgentConfig | null {
    if (signal.target.axis !== this.axis) return null;

    const cloned = structuredClone(current);
    if (signal.suggested_action === 'workflow_param_update') {
      if (signal.target.config_path.includes('retry_storm_limit')) {
        cloned.workflow.retry_storm_limit = Math.min(10, cloned.workflow.retry_storm_limit + 1);
      } else {
        cloned.workflow.max_iterations = Math.min(50, cloned.workflow.max_iterations + 2);
      }
    }

    return cloned;
  }
}
