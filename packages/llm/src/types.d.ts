export interface ChatRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
}
export interface ChatResponse {
  content: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
  provider: string;
}
export interface LlmProvider {
  chat(req: ChatRequest): Promise<ChatResponse>;
  embed(texts: string[]): Promise<number[][]>;
}
//# sourceMappingURL=types.d.ts.map
