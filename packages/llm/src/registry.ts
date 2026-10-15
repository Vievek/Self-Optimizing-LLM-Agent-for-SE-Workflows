import { LlmProvider } from './types.js';
import { OpenAiCompatProvider } from './openai-compat-provider.js';
import { RequestQueue } from './queue.js';
import { loadModelsConfig, ModelsConfig } from './models-config.js';

export type TierName = 'slm' | 'llm' | 'small' | 'large' | 'embed';

export class ProviderRegistry {
  private readonly config: ModelsConfig;
  private readonly sharedQueue: RequestQueue;
  private readonly instances = new Map<string, LlmProvider>();
  private readonly customFactories = new Map<
    string,
    (options: Record<string, unknown>) => LlmProvider
  >();

  constructor(config?: ModelsConfig, queue?: RequestQueue) {
    this.config = config ?? loadModelsConfig();
    this.sharedQueue = queue ?? new RequestQueue();
  }

  registerCustomProvider(
    name: string,
    factory: (options: Record<string, unknown>) => LlmProvider,
  ): void {
    this.customFactories.set(name, factory);
  }

  setProvider(tierOrName: string, provider: LlmProvider): void {
    this.instances.set(tierOrName, provider);
  }

  getProvider(tier: TierName): LlmProvider {
    const canonicalKey = tier === 'slm' ? 'small' : tier === 'llm' ? 'large' : tier;

    if (this.instances.has(canonicalKey)) {
      return this.instances.get(canonicalKey)!;
    }

    const tierConfig = this.config[canonicalKey as keyof ModelsConfig];
    if (!tierConfig) {
      throw new Error(`Unknown model tier: ${tier}`);
    }

    let provider: LlmProvider;
    if (tierConfig.provider === 'openai_compat') {
      provider = OpenAiCompatProvider.fromConfig(tierConfig, this.sharedQueue);
    } else if (this.customFactories.has(tierConfig.provider)) {
      const factory = this.customFactories.get(tierConfig.provider)!;
      provider = factory(tierConfig as unknown as Record<string, unknown>);
    } else {
      throw new Error(
        `Unsupported provider "${tierConfig.provider}" for tier "${tier}". Register it using registerCustomProvider.`,
      );
    }

    this.instances.set(canonicalKey, provider);
    return provider;
  }
}

// Global default singleton registry
let defaultRegistry: ProviderRegistry | undefined;

export function getDefaultRegistry(): ProviderRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new ProviderRegistry();
  }
  return defaultRegistry;
}

export function getProvider(tier: TierName): LlmProvider {
  return getDefaultRegistry().getProvider(tier);
}
