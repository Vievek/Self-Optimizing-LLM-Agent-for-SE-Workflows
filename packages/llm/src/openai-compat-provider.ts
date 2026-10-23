import { ChatRequest, ChatResponse, LlmProvider } from './types.js';
import { RequestQueue } from './queue.js';
import { ModelTierConfig } from './models-config.js';

export interface OpenAiCompatProviderOptions {
  baseUrl: string;
  defaultModel?: string;
  defaultMaxTokens?: number;
  apiKey?: string;
  apiKeyEnv?: string;
  queue?: RequestQueue;
}

export class OpenAiCompatProvider implements LlmProvider {
  private readonly baseUrl: string;
  private readonly defaultModel?: string;
  private readonly defaultMaxTokens?: number;
  private readonly apiKey?: string;
  private readonly apiKeyEnv?: string;
  private readonly queue: RequestQueue;

  constructor(options: OpenAiCompatProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.defaultModel = options.defaultModel;
    this.defaultMaxTokens = options.defaultMaxTokens;
    this.apiKey = options.apiKey;
    this.apiKeyEnv = options.apiKeyEnv;
    this.queue = options.queue ?? new RequestQueue();
  }

  static fromConfig(config: ModelTierConfig, queue?: RequestQueue): OpenAiCompatProvider {
    return new OpenAiCompatProvider({
      baseUrl: config.baseUrl,
      defaultModel: config.model,
      defaultMaxTokens: config.maxTokens,
      apiKey: config.apiKey,
      apiKeyEnv: config.apiKeyEnv,
      queue,
    });
  }

  private resolveApiKey(): string | undefined {
    if (this.apiKey) return this.apiKey;
    if (this.apiKeyEnv && process.env[this.apiKeyEnv]) {
      return process.env[this.apiKeyEnv];
    }
    return undefined;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const model = req.model || this.defaultModel;
    if (!model) {
      throw new Error('Model is required for chat completion');
    }

    const apiKey = this.resolveApiKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let currentMaxTokens = req.maxTokens ?? this.defaultMaxTokens ?? 1000;

    return this.queue.enqueue(async () => {
      const endpoint = `${this.baseUrl}/chat/completions`;
      const payload = {
        model,
        messages: req.messages,
        temperature: req.temperature ?? 0,
        max_tokens: currentMaxTokens,
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        // If provider rejected due to OTPM ceiling or suggests reducing max_tokens, clamp down for retry
        if (
          errText.includes('OTPM') ||
          errText.includes('Reduce max_tokens') ||
          errText.includes('output tokens per minute')
        ) {
          const clamped = Math.max(500, Math.min(currentMaxTokens - 200, 800));
          currentMaxTokens = clamped;
        }

        throw new Error(
          `OpenAI-compat chat request to ${endpoint} failed with HTTP ${res.status}: ${errText}`,
        );
      }

      const data = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
            reasoning_content?: string;
            thought?: string;
          };
          text?: string;
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };

      const choice = data.choices?.[0];
      const message = choice?.message;
      const rawContent = (message?.content ?? '').trim();
      const reasoning = (message?.reasoning_content ?? message?.thought ?? '').trim();

      let content = rawContent;
      if (!content && reasoning) {
        // If content is empty but model emitted reasoning/thinking tokens
        content = reasoning;
      } else if (!content && typeof choice?.text === 'string') {
        content = choice.text.trim();
      } else if (content && reasoning && !content.toLowerCase().includes('thought:')) {
        // Prepend reasoning as thought for downstream ReAct parsers
        content = `Thought: ${reasoning}\n\n${content}`;
      }

      const tokensIn = data.usage?.prompt_tokens ?? 0;
      const tokensOut = data.usage?.completion_tokens ?? 0;

      return {
        content,
        tokensIn,
        tokensOut,
        model: data.model ?? model,
        provider: 'openai_compat',
      };
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const model = this.defaultModel;
    if (!model) {
      throw new Error('Model is required for embeddings');
    }

    const apiKey = this.resolveApiKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const payload = {
      model,
      input: texts,
    };

    return this.queue.enqueue(async () => {
      const endpoint = `${this.baseUrl}/embeddings`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(
          `OpenAI-compat embeddings request to ${endpoint} failed with HTTP ${res.status}: ${errText}`,
        );
      }

      const data = (await res.json()) as {
        data?: Array<{ embedding: number[]; index: number }>;
      };

      const embeddings = (data.data ?? [])
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);

      return embeddings;
    });
  }
}
