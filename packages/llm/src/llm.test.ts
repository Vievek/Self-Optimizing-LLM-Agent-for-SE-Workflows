import { describe, it, expect, vi } from 'vitest';
import {
  RequestQueue,
  parseModelsYaml,
  loadModelsConfig,
  OpenAiCompatProvider,
  ProviderRegistry,
} from './index.js';

describe('LLM Package Tests', () => {
  describe('RequestQueue', () => {
    it('throttles concurrency to configured maximum', async () => {
      const queue = new RequestQueue({ maxConcurrency: 2 });
      let currentActive = 0;
      let peakActive = 0;

      const task = async () => {
        return queue.enqueue(async () => {
          currentActive++;
          peakActive = Math.max(peakActive, currentActive);
          await new Promise((r) => setTimeout(r, 20));
          currentActive--;
          return 'ok';
        });
      };

      await Promise.all([task(), task(), task(), task()]);
      expect(peakActive).toBeLessThanOrEqual(2);
    });

    it('retries on retryable errors and succeeds when resolved', async () => {
      const queue = new RequestQueue({ maxRetries: 2, baseDelayMs: 10 });
      let attempts = 0;

      const result = await queue.enqueue(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('HTTP 429 rate limit exceeded');
        }
        return 'success';
      });

      expect(attempts).toBe(2);
      expect(result).toBe('success');
    });

    it('throws when max retries exceeded', async () => {
      const queue = new RequestQueue({ maxRetries: 1, baseDelayMs: 5 });
      await expect(
        queue.enqueue(async () => {
          throw new Error('HTTP 503 service unavailable');
        }),
      ).rejects.toThrow('503');
    });
  });

  describe('Models Configuration', () => {
    it('parses models.yaml content into typed configuration', () => {
      const yaml = `
small:
  provider: openai_compat
  baseUrl: https://router.huggingface.co/v1
  model: Qwen/Qwen2.5-Coder-7B-Instruct
  pacingMs: 4000
  maxBatchWriteFiles: 3
  maxBatchReadFiles: 8
large:
  provider: openai_compat
  baseUrl: https://router.huggingface.co/v1
  model: Qwen/Qwen2.5-Coder-32B-Instruct
  pacingMs: 5000
  maxBatchWriteFiles: 4
  maxBatchReadFiles: 10
embed:
  provider: openai_compat
  baseUrl: https://router.huggingface.co/v1
  model: BAAI/bge-small-en-v1.5
      `;
      const config = parseModelsYaml(yaml);
      expect(config.small.model).toBe('Qwen/Qwen2.5-Coder-7B-Instruct');
      expect(config.small.pacingMs).toBe(4000);
      expect(config.small.maxBatchWriteFiles).toBe(3);
      expect(config.small.maxBatchReadFiles).toBe(8);
      expect(config.large.model).toBe('Qwen/Qwen2.5-Coder-32B-Instruct');
      expect(config.large.pacingMs).toBe(5000);
      expect(config.large.maxBatchWriteFiles).toBe(4);
      expect(config.embed.model).toBe('BAAI/bge-small-en-v1.5');
    });

    it('loads defaults when file does not exist', () => {
      const config = loadModelsConfig('/non/existent/path.yaml');
      expect(config.small.provider).toBe('openai_compat');
      expect(config.large.provider).toBe('openai_compat');
    });
  });

  describe('OpenAiCompatProvider', () => {
    it('executes chat completion with correct request shape', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Generated code fix' } }],
          usage: { prompt_tokens: 150, completion_tokens: 50 },
          model: 'Qwen/Qwen2.5-Coder-32B-Instruct',
        }),
      });
      global.fetch = mockFetch;

      const provider = new OpenAiCompatProvider({
        baseUrl: 'https://router.huggingface.co/v1',
        apiKey: 'test-key',
        defaultModel: 'Qwen/Qwen2.5-Coder-32B-Instruct',
      });

      const response = await provider.chat({
        model: 'Qwen/Qwen2.5-Coder-32B-Instruct',
        messages: [{ role: 'user', content: 'Fix the bug' }],
      });

      expect(response.content).toBe('Generated code fix');
      expect(response.tokensIn).toBe(150);
      expect(response.tokensOut).toBe(50);
      expect(response.provider).toBe('openai_compat');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://router.huggingface.co/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
          }),
        }),
      );
    });

    it('executes embeddings request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { index: 0, embedding: [0.1, 0.2] },
            { index: 1, embedding: [0.3, 0.4] },
          ],
        }),
      });
      global.fetch = mockFetch;

      const provider = new OpenAiCompatProvider({
        baseUrl: 'https://router.huggingface.co/v1',
        defaultModel: 'BAAI/bge-small-en-v1.5',
      });

      const embeddings = await provider.embed(['text1', 'text2']);
      expect(embeddings).toEqual([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);
    });
  });

  describe('ProviderRegistry', () => {
    it('resolves providers for slm and llm tiers', () => {
      const registry = new ProviderRegistry();
      const slm = registry.getProvider('slm');
      const llm = registry.getProvider('llm');

      expect(slm).toBeDefined();
      expect(llm).toBeDefined();
    });
  });
});
