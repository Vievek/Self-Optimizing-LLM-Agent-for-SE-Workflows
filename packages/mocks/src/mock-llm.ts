import { ChatRequest, ChatResponse, LlmProvider } from '@soa/llm';

export class MockLlmProvider implements LlmProvider {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    return {
      content: 'Mock LLM Response',
      tokensIn: 10,
      tokensOut: 10,
      model: req.model,
      provider: 'mock',
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(1536).fill(0));
  }
}
