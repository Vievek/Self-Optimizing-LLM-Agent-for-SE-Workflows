import type { FullAgentConfig, OptimizationSignal } from '@soa/contracts';
import type { AxisOptimizer } from './axis-optimizer.js';

export class ToolOptimizer implements AxisOptimizer {
  readonly axis = 'tool' as const;

  apply(signal: OptimizationSignal, current: FullAgentConfig): FullAgentConfig | null {
    if (signal.target.axis !== this.axis) return null;

    const cloned = structuredClone(current);
    // Path might be 'tools.apply_patch' or 'tools.apply_patch.description' or 'tools.tools.apply_patch'
    const parts = signal.target.config_path.split('.');
    const toolName = parts[parts[0] === 'tools' && parts[1] === 'tools' ? 2 : 1] || 'apply_patch';

    if (cloned.tools.tools[toolName]) {
      const tool = cloned.tools.tools[toolName];
      if (signal.suggested_action === 'tool_description_refine') {
        tool.description = `${tool.description} Note: ${signal.root_cause.summary}`.slice(0, 300);
      } else if (signal.suggested_action === 'tool_routing_update') {
        tool.timeout_s = Math.min(600, (tool.timeout_s ?? 30) + 15);
      }
    }

    return cloned;
  }
}
