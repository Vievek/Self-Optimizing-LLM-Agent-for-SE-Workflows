
import type {
  ChatRequest,
  ChatResponse,
  LlmProvider,
} from '@soa/llm';

interface OllamaChatResponse {
  model: string;
  message: {
    role: string;
    content: string;
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface OllamaProviderOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export class OllamaProvider implements LlmProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: OllamaProviderOptions = {}) {
    const url = new URL(
      options.baseUrl ?? 'http://127.0.0.1:11434',
    );

    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(
        url.hostname,
      ) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    ) {
      throw new Error(
        'OllamaProvider only allows a local HTTP endpoint.',
      );
    }

    if (
      options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) ||
        options.timeoutMs <= 0)
    ) {
      throw new Error('Invalid Ollama timeout.');
    }

    this.baseUrl = url.origin;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!req.model.trim()) {
      throw new Error('Ollama model name is required.');
    }

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream: false,
          format: 'json',
          options: {
            temperature: req.temperature ?? 0,
            ...(req.maxTokens !== undefined
              ? { num_predict: req.maxTokens }
              : {}),
            num_ctx: 4096,
          },
        }),
      });
    } catch (error) {
      throw new Error(
        'Local Ollama request failed: ' +
          (error instanceof Error
            ? error.message
            : String(error)),
      );
    }

    if (!response.ok) {
      throw new Error(
        `Ollama HTTP error: ${response.status}`,
      );
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new Error(
        'Ollama returned an invalid JSON response.',
      );
    }

    if (!this.isChatResponse(body)) {
      throw new Error(
        'Ollama response is missing required fields.',
      );
    }

    return {
      content: body.message.content,
      tokensIn: body.prompt_eval_count ?? 0,
      tokensOut: body.eval_count ?? 0,
      model: body.model,
      provider: 'ollama-local',
    };
  }

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error(
      'OllamaProvider is restricted to HEAE chat judgment; ' +
        'embeddings are not supported.',
    );
  }

  private isChatResponse(
    value: unknown,
  ): value is OllamaChatResponse {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const record = value as Record<string, unknown>;

    if (
      typeof record.model !== 'string' ||
      typeof record.message !== 'object' ||
      record.message === null
    ) {
      return false;
    }

    const message = record.message as Record<
      string,
      unknown
    >;

    return (
      typeof message.content === 'string' &&
      typeof message.role === 'string' &&
      (record.prompt_eval_count === undefined ||
        (typeof record.prompt_eval_count === 'number' &&
          Number.isFinite(record.prompt_eval_count) &&
          record.prompt_eval_count >= 0)) &&
      (record.eval_count === undefined ||
        (typeof record.eval_count === 'number' &&
          Number.isFinite(record.eval_count) &&
          record.eval_count >= 0))
    );
  }
}
