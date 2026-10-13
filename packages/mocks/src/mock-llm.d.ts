import { ChatRequest, ChatResponse, LlmProvider } from '@soa/llm';
export declare class MockLlmProvider implements LlmProvider {
  chat(req: ChatRequest): Promise<ChatResponse>;
  embed(texts: string[]): Promise<number[][]>;
}
//# sourceMappingURL=mock-llm.d.ts.map
