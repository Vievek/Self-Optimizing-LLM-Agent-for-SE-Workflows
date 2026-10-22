import { ModelTier } from '../types.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ContextBudgetConfig {
  maxTotalTokens: number;
  reservedOutputTokens: number;
}

/**
 * Tier-specific token budgets calibrated for Qwen 7B (SLM) and Qwen 32B (LLM).
 * Also strictly respected when testing with Gemini Flash (SLM) and Pro (LLM).
 */
export const TIER_CONTEXT_BUDGETS: Record<ModelTier, ContextBudgetConfig> = {
  slm: {
    maxTotalTokens: 8192,
    reservedOutputTokens: 1024,
  },
  llm: {
    maxTotalTokens: 32768,
    reservedOutputTokens: 4096,
  },
};

/**
 * Fast approximation of token count based on standard ~4 chars per token heuristic.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export class ConversationHistory {
  private messages: ChatMessage[] = [];
  private readonly tier: ModelTier;
  private readonly budget: ContextBudgetConfig;

  constructor(tier: ModelTier = 'slm', customBudget?: Partial<ContextBudgetConfig>) {
    this.tier = tier;
    const baseBudget = TIER_CONTEXT_BUDGETS[tier];
    this.budget = {
      maxTotalTokens: customBudget?.maxTotalTokens ?? baseBudget.maxTotalTokens,
      reservedOutputTokens: customBudget?.reservedOutputTokens ?? baseBudget.reservedOutputTokens,
    };
  }

  addMessage(role: ChatMessage['role'], content: string): this {
    this.messages.push({ role, content });
    return this;
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  getTotalTokens(): number {
    return this.messages.reduce((acc, msg) => acc + estimateTokens(msg.content), 0);
  }

  getAvailableInputBudget(): number {
    return Math.max(0, this.budget.maxTotalTokens - this.budget.reservedOutputTokens);
  }

  /**
   * Compresses or prunes intermediate turns to ensure total input tokens stay strictly
   * within the available budget for the active model tier.
   *
   * Preserves:
   * 1. System prompt (index 0 if present)
   * 2. Initial user task prompt (index 1 if present)
   * 3. Most recent turns leading up to current decision
   */
  getCompactedMessages(): ChatMessage[] {
    const inputBudget = this.getAvailableInputBudget();
    const currentTokens = this.getTotalTokens();

    if (currentTokens <= inputBudget || this.messages.length <= 3) {
      return [...this.messages];
    }

    // Identify pinned anchor messages
    const systemMsg = this.messages.find((m) => m.role === 'system');
    const initialUserMsg = this.messages.find((m, idx) => m.role === 'user' && idx <= 1);

    const pinnedCount = (systemMsg ? 1 : 0) + (initialUserMsg ? 1 : 0);
    const flexibleMessages = this.messages.slice(pinnedCount);

    // Reserve token space for the continuity notice
    const NOTICE_RESERVE_TOKENS = 35;
    const effectiveBudget = Math.max(0, inputBudget - NOTICE_RESERVE_TOKENS);

    // Prune oldest flexible turns from the middle/start until within budget
    const keptFlexible: ChatMessage[] = [];
    const reversedFlexible = [...flexibleMessages].reverse();

    let accumulatedTokens =
      (systemMsg ? estimateTokens(systemMsg.content) : 0) +
      (initialUserMsg ? estimateTokens(initialUserMsg.content) : 0);

    for (const msg of reversedFlexible) {
      const msgTokens = estimateTokens(msg.content);
      if (accumulatedTokens + msgTokens <= effectiveBudget) {
        keptFlexible.unshift(msg);
        accumulatedTokens += msgTokens;
      } else {
        // Can fit no more prior turns
        break;
      }
    }

    const result: ChatMessage[] = [];
    if (systemMsg) result.push(systemMsg);
    if (initialUserMsg) result.push(initialUserMsg);

    // If any intermediate messages were omitted, insert an explicit continuity notice
    const omittedCount = flexibleMessages.length - keptFlexible.length;
    if (omittedCount > 0) {
      result.push({
        role: 'user',
        content: `[Notice: ${omittedCount} earlier tool interaction turns were summarized/compacted to maintain the ${this.tier.toUpperCase()} ${this.budget.maxTotalTokens / 1024}k token budget.]`,
      });
    }

    result.push(...keptFlexible);
    return result;
  }
}
