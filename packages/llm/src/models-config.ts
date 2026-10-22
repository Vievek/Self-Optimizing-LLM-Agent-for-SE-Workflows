import fs from 'node:fs';
import path from 'node:path';

export interface ModelTierConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
  apiKey?: string;
  maxTokens?: number;
}

export interface ModelsConfig {
  small: ModelTierConfig;
  large: ModelTierConfig;
  embed: ModelTierConfig;
}

export const DEFAULT_MODELS_CONFIG: ModelsConfig = {
  small: {
    provider: 'openai_compat',
    baseUrl: 'https://router.huggingface.co/v1',
    model: 'Qwen/Qwen2.5-Coder-7B-Instruct',
    apiKeyEnv: 'HF_TOKEN',
  },
  large: {
    provider: 'openai_compat',
    baseUrl: 'https://router.huggingface.co/v1',
    model: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    apiKeyEnv: 'HF_TOKEN',
  },
  embed: {
    provider: 'openai_compat',
    baseUrl: 'https://router.huggingface.co/v1',
    model: 'BAAI/bge-small-en-v1.5',
    apiKeyEnv: 'HF_TOKEN',
  },
};

/**
 * Parses simple YAML key-value sections for models configuration.
 */
export function parseModelsYaml(content: string): ModelsConfig {
  const result: Record<string, Record<string, string>> = {
    small: {},
    large: {},
    embed: {},
  };

  let currentSection = '';
  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (!rawLine.startsWith(' ') && line.endsWith(':')) {
      currentSection = line.slice(0, -1).trim();
      if (!result[currentSection]) {
        result[currentSection] = {};
      }
      continue;
    }

    if (currentSection && line.includes(':')) {
      const colonIdx = line.indexOf(':');
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();
      // Remove surrounding quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      const section = result[currentSection];
      if (section) {
        section[key] = value;
      }
    }
  }

  const getTier = (key: 'small' | 'large' | 'embed'): ModelTierConfig => {
    const raw = result[key] ?? {};
    const fallback = DEFAULT_MODELS_CONFIG[key];
    return {
      provider: raw['provider'] || fallback.provider,
      baseUrl: raw['baseUrl'] || fallback.baseUrl,
      model: raw['model'] || fallback.model,
      apiKeyEnv: raw['apiKeyEnv'] || fallback.apiKeyEnv,
      apiKey: raw['apiKey'] || fallback.apiKey,
      maxTokens: raw['maxTokens'] ? parseInt(raw['maxTokens'], 10) : fallback.maxTokens,
    };
  };

  return {
    small: getTier('small'),
    large: getTier('large'),
    embed: getTier('embed'),
  };
}

/**
 * Loads models configuration from a file or falls back to package models.yaml or defaults.
 */
export function loadModelsConfig(filePath?: string): ModelsConfig {
  const candidates = [
    filePath,
    process.env['MODELS_CONFIG_PATH'],
    path.resolve(process.cwd(), 'packages/llm/models.yaml'),
    path.resolve(process.cwd(), 'models.yaml'),
    new URL('../models.yaml', import.meta.url).pathname,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const text = fs.readFileSync(candidate, 'utf-8');
        return parseModelsYaml(text);
      }
    } catch {
      // Continue to next candidate
    }
  }

  return DEFAULT_MODELS_CONFIG;
}
