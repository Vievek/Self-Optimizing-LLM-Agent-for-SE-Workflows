import { afterEach, describe, expect, it, vi } from 'vitest';

import { OllamaProvider } from './ollama-provider.js';

const MODEL = 'qwen2.5-coder:3b';

const messages = [
  {
    role: 'system' as const,
    content: 'Return valid JSON only.',
  },
  {
    role: 'user' as const,
    content: 'Assess the supplied failure evidence.',
  },
];

function mockOllamaResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      model: MODEL,
      message: {
        role: 'assistant',
        content: '{"findings":[],"overallUncertainty":"None"}',
      },
      prompt_eval_count: 120,
      eval_count: 40,
      ...overrides,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HEAE local Ollama provider', () => {
  it('maps chat requests and responses correctly', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockOllamaResponse());

    vi.stubGlobal('fetch', fetchMock);

    const provider = new OllamaProvider();

    const result = await provider.chat({
      model: MODEL,
      messages,
      temperature: 0,
      maxTokens: 1200,
    });

    expect(result).toEqual({
      content: '{"findings":[],"overallUncertainty":"None"}',
      tokensIn: 120,
      tokensOut: 40,
      model: MODEL,
      provider: 'ollama-local',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('http://127.0.0.1:11434/api/chat');

    expect(options.method).toBe('POST');

    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
    });

    const body = JSON.parse(options.body as string) as Record<string, unknown>;

    expect(body.model).toBe(MODEL);
    expect(body.messages).toEqual(messages);
    expect(body.stream).toBe(false);
    expect(body.format).toBe('json');

    expect(body.options).toEqual({
      temperature: 0,
      num_predict: 1200,
      num_ctx: 4096,
    });

    expect(options.signal).toBeDefined();
  });

  it('rejects non-local inference endpoints', () => {
    expect(
      () =>
        new OllamaProvider({
          baseUrl: 'https://example.com',
        }),
    ).toThrow('only allows a local HTTP endpoint');

    expect(
      () =>
        new OllamaProvider({
          baseUrl: 'http://192.168.1.10:11434',
        }),
    ).toThrow('only allows a local HTTP endpoint');

    expect(
      () =>
        new OllamaProvider({
          baseUrl: 'http://127.0.0.1:11434/other',
        }),
    ).toThrow('only allows a local HTTP endpoint');
  });

  it('rejects invalid timeout configuration', () => {
    expect(
      () =>
        new OllamaProvider({
          timeoutMs: 0,
        }),
    ).toThrow('Invalid Ollama timeout');

    expect(
      () =>
        new OllamaProvider({
          timeoutMs: -1,
        }),
    ).toThrow('Invalid Ollama timeout');
  });

  it('rejects an empty model name', async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal('fetch', fetchMock);

    const provider = new OllamaProvider();

    await expect(
      provider.chat({
        model: '   ',
        messages,
      }),
    ).rejects.toThrow('model name is required');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a local connection failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

    const provider = new OllamaProvider();

    await expect(
      provider.chat({
        model: MODEL,
        messages,
      }),
    ).rejects.toThrow('Local Ollama request failed: Connection refused');
  });

  it('reports an Ollama HTTP failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('Model not found', {
          status: 404,
        }),
      ),
    );

    const provider = new OllamaProvider();

    await expect(
      provider.chat({
        model: MODEL,
        messages,
      }),
    ).rejects.toThrow('Ollama HTTP error: 404');
  });

  it('rejects a malformed Ollama response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockOllamaResponse({
          message: {
            role: 'assistant',
            content: 123,
          },
        }),
      ),
    );

    const provider = new OllamaProvider();

    await expect(
      provider.chat({
        model: MODEL,
        messages,
      }),
    ).rejects.toThrow('Ollama response is missing required fields');
  });

  it('rejects invalid response JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('not-json', {
          status: 200,
        }),
      ),
    );

    const provider = new OllamaProvider();

    await expect(
      provider.chat({
        model: MODEL,
        messages,
      }),
    ).rejects.toThrow('Ollama returned an invalid JSON response');
  });

  it('does not fabricate embeddings', async () => {
    const provider = new OllamaProvider();

    await expect(provider.embed(['test'])).rejects.toThrow('embeddings are not supported');
  });
});
