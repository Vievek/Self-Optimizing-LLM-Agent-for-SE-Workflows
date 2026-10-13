import { Config, OptimizationSignal } from '@soa/contracts';

export class MockOrchestrator {
  async optimize(signal: OptimizationSignal, currentConfig: Config): Promise<Config> {
    return {
      ...currentConfig,
      updated_at: signal.timestamp,
    };
  }
}
