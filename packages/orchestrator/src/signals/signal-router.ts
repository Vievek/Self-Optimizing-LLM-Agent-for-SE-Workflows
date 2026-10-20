import type {
  FullAgentConfig,
  OptimizationSignal,
  OptimizationTargetAxis,
} from '@soa/contracts';
import type { AxisOptimizer } from '../optimizers/axis-optimizer.js';

/**
 * SignalRouter – Routes incoming signals to appropriate AxisOptimizer
 * based on target.axis.
 */
export class SignalRouter {
  private readonly optimizers = new Map<OptimizationTargetAxis, AxisOptimizer>();

  register(optimizer: AxisOptimizer): void {
    this.optimizers.set(optimizer.axis, optimizer);
  }

  getOptimizer(axis: OptimizationTargetAxis): AxisOptimizer | undefined {
    return this.optimizers.get(axis);
  }

  route(signal: OptimizationSignal, currentConfig: FullAgentConfig): FullAgentConfig | null {
    const optimizer = this.optimizers.get(signal.target.axis);
    if (!optimizer) {
      throw new Error(`No optimizer registered for axis: "${signal.target.axis}"`);
    }
    return optimizer.apply(signal, currentConfig);
  }
}
