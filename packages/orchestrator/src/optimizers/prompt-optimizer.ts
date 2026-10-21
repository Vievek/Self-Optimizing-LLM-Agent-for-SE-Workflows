import type { FullAgentConfig, OptimizationSignal } from '@soa/contracts';
import type { AxisOptimizer } from './axis-optimizer.js';

export class PromptOptimizer implements AxisOptimizer {
  readonly axis = 'prompt' as const;

  apply(signal: OptimizationSignal, current: FullAgentConfig): FullAgentConfig | null {
    if (signal.target.axis !== this.axis) return null;

    const cloned = structuredClone(current);
    const templateKey = signal.target.affected_subtask || 'system';

    if (cloned.prompts.templates[templateKey]) {
      cloned.prompts.templates[templateKey].template +=
        `\n# Guidance from HEAE: ${signal.root_cause.summary}`;
    } else {
      cloned.prompts.system_prompt_version = `${cloned.prompts.system_prompt_version}_opt`;
    }

    return cloned;
  }
}
