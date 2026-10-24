import {
  ModelTier,
  SubTask,
  ToolCallRequest,
  ToolContext,
  TraceSpan,
  AgentTask,
} from '../types.js';
import { ChatMessage, ConversationHistoryManager } from '../context/index.js';

export interface ParsedReActStep {
  thought?: string;
  toolCall?: ToolCallRequest;
  toolCalls?: ToolCallRequest[];
  finalAnswer?: string;
  isFinal: boolean;
  raw: string;
}

export interface ReActLlmResponse {
  content: string;
  tokensIn?: number;
  tokensOut?: number;
  model?: string;
  provider?: string;
}

export type ReActLlmCaller = (
  messages: ChatMessage[],
  options?: { tier?: ModelTier; model?: string },
) => Promise<ReActLlmResponse>;

export interface ExecuteSubtaskParams {
  task: AgentTask;
  subtask: SubTask;
  context: ToolContext;
  llmCaller: ReActLlmCaller;
  tier?: ModelTier;
  model?: string;
  maxTurns?: number;
  traceId?: string;
  parentSpanId?: string | null;
  historyManager?: ConversationHistoryManager;
  systemPrompt?: string;
  previousContext?: string;
  maxBatchWriteFiles?: number;
  maxBatchReadFiles?: number;
  knownWrittenFiles?: Set<string>;
}

export interface ExecuteSubtaskResult {
  success: boolean;
  subtask: SubTask;
  turns: number;
  totalTokensIn: number;
  totalTokensOut: number;
  toolCallsExecuted: number;
  finalAnswer?: string;
  lastError?: string;
  spans: TraceSpan[];
  testSummary?: { passed?: number; failed?: number; errors?: number };
  writtenFiles: string[];
}
