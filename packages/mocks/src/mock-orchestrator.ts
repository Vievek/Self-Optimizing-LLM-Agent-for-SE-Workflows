import {
  type Config,
  type FullAgentConfig,
  type OptimizationSignal,
  generateConfigVersion,
} from '@soa/contracts';

export class MockOrchestrator {
  private versionCounter = 1;

  async optimize(_signal: OptimizationSignal, currentConfig: Config): Promise<Config> {
    this.versionCounter++;
    return {
      ...currentConfig,
      version: generateConfigVersion(this.versionCounter),
      updated_at: new Date().toISOString(),
    };
  }

  async optimizeFullConfig(
    signal: OptimizationSignal,
    currentConfig: FullAgentConfig,
  ): Promise<FullAgentConfig> {
    this.versionCounter++;
    const nextVer = generateConfigVersion(this.versionCounter);

    const updated = structuredClone(currentConfig);
    updated.config_version = nextVer;

    if (signal.target.axis === 'tool' && signal.suggested_action === 'tool_description_refine') {
      const toolName = signal.target.config_path.split('.')[1] || 'apply_patch';
      const toolDef = updated.tools.tools[toolName];
      if (toolDef) {
        toolDef.description += ' (refined)';
      }
    } else if (signal.target.axis === 'retrieval') {
      updated.retrieval.top_k = Math.min(20, updated.retrieval.top_k + 1);
    } else if (signal.target.axis === 'planning') {
      updated.planning.backtrack_depth = Math.min(5, updated.planning.backtrack_depth + 1);
    }

    return updated;
  }
}
