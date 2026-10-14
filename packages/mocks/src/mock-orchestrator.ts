import { type Config, type OptimizationSignal } from '@soa/contracts';

export class MockOrchestrator {
  async optimize(_signal: OptimizationSignal, currentConfig: Config): Promise<Config> {
    return {
      ...currentConfig,
      updated_at: new Date().toISOString(),
    };
  }
}
