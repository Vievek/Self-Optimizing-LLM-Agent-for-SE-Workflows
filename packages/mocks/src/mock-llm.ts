import { ChatRequest, ChatResponse, LlmProvider } from '@soa/llm';

export type CannedMatcher = string | RegExp | ((req: ChatRequest) => boolean);

export interface CannedEntry {
  matcher: CannedMatcher;
  response: string | Partial<ChatResponse>;
}

export class MockLlmProvider implements LlmProvider {
  private readonly cannedResponses: CannedEntry[] = [];
  public readonly recordedRequests: ChatRequest[] = [];
  public defaultResponse = 'Mock LLM Response';

  /**
   * Register a canned answer for a specific prompt substring, regex, or predicate.
   */
  registerCanned(matcher: CannedMatcher, response: string | Partial<ChatResponse>): void {
    this.cannedResponses.push({ matcher, response });
  }

  /**
   * Clear all registered canned responses.
   */
  clearCanned(): void {
    this.cannedResponses.length = 0;
  }

  /**
   * Clear recorded requests.
   */
  clearHistory(): void {
    this.recordedRequests.length = 0;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.recordedRequests.push(req);

    // Check registered canned responses in order
    const fullText = req.messages.map((m) => m.content).join('\n');

    for (const entry of this.cannedResponses) {
      let isMatch = false;
      if (typeof entry.matcher === 'string') {
        isMatch = fullText.includes(entry.matcher);
      } else if (entry.matcher instanceof RegExp) {
        isMatch = entry.matcher.test(fullText);
      } else if (typeof entry.matcher === 'function') {
        isMatch = entry.matcher(req);
      }

      if (isMatch) {
        if (typeof entry.response === 'string') {
          return {
            content: entry.response,
            tokensIn: Math.ceil(fullText.length / 4),
            tokensOut: Math.ceil(entry.response.length / 4),
            model: req.model,
            provider: 'mock',
          };
        } else {
          const content = entry.response.content ?? this.defaultResponse;
          return {
            content,
            tokensIn: entry.response.tokensIn ?? Math.ceil(fullText.length / 4),
            tokensOut: entry.response.tokensOut ?? Math.ceil(content.length / 4),
            model: entry.response.model ?? req.model,
            provider: entry.response.provider ?? 'mock',
          };
        }
      }
    }

    return {
      content: this.defaultResponse,
      tokensIn: Math.ceil(fullText.length / 4) || 10,
      tokensOut: Math.ceil(this.defaultResponse.length / 4) || 10,
      model: req.model,
      provider: 'mock',
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text, i) => {
      // Deterministic pseudo-embedding based on text index and characters
      const vec = new Array(1536).fill(0);
      const seed = text.length + i;
      vec[0] = (seed % 100) / 100;
      vec[1] = ((seed * 7) % 100) / 100;
      return vec;
    });
  }
}
