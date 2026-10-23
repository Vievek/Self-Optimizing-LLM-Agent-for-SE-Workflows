import { ProviderRegistry, ModelsConfig, getDefaultRegistry } from '@soa/llm';
import { ReActLlmCaller, ReActLlmResponse } from './react/types.js';
import { ModelTier, SubTask, ToolCallRequest } from './types.js';
import { ChatMessage } from './context/index.js';
import { PromptBuilder } from './prompts/prompt-builder.js';
import { ToolCallParser } from './react/tool-call-parser.js';

export interface LlmBridgeOptions {
  registry?: ProviderRegistry;
  modelsConfig?: ModelsConfig;
  temperature?: number;
}

/**
 * Creates a ReActLlmCaller wired directly to @soa/llm ProviderRegistry.
 * Dispatches 'slm' calls to the configured small model (e.g. Qwen 7B / Gemini Flash)
 * and 'llm' calls to the configured large model (e.g. Qwen 32B / Gemini Pro).
 */
export function createReActLlmCaller(options: LlmBridgeOptions = {}): ReActLlmCaller {
  const registry = options.registry ?? getDefaultRegistry();
  const temperature = options.temperature ?? 0.2;

  return async (
    messages: ChatMessage[],
    callOptions?: { tier?: ModelTier; model?: string },
  ): Promise<ReActLlmResponse> => {
    const tier = callOptions?.tier ?? 'slm';
    const provider = registry.getProvider(tier);
    const modelsConfig = options.modelsConfig ?? registry.getConfig();

    const canonicalTier = tier === 'slm' ? 'small' : 'large';
    const configuredModel = modelsConfig?.[canonicalTier]?.model;
    const model =
      configuredModel ??
      callOptions?.model ??
      (tier === 'slm' ? 'qwen2.5-coder-7b-instruct' : 'qwen2.5-coder-32b-instruct');

    const configuredMaxTokens = modelsConfig?.[canonicalTier]?.maxTokens;
    const pacingMs = modelsConfig?.[canonicalTier]?.pacingMs;
    if (typeof pacingMs === 'number' && pacingMs > 0) {
      await new Promise((r) => setTimeout(r, pacingMs));
    }

    const chatResponse = await provider.chat({
      model,
      messages,
      temperature,
      ...(configuredMaxTokens ? { maxTokens: configuredMaxTokens } : {}),
    });

    return {
      content: chatResponse.content,
      tokensIn: chatResponse.tokensIn,
      tokensOut: chatResponse.tokensOut,
      model: chatResponse.model,
      provider: chatResponse.provider,
    };
  };
}

/**
 * Adapter bridging @soa/llm into the single-turn LLMCaller interface.
 */
export function createSubtaskToolCaller(
  options: LlmBridgeOptions = {},
): (
  prompt: string,
  subtask: SubTask,
  tier: ModelTier,
  model: string,
) => Promise<ToolCallRequest[]> {
  const reactCaller = createReActLlmCaller(options);

  return async (prompt, subtask, tier, model) => {
    const promptBuilder = new PromptBuilder();
    const systemPrompt = promptBuilder.buildSystemPrompt();
    const userPrompt = promptBuilder.buildSubtaskPrompt(
      {
        taskId: subtask.id,
        problemStatement: prompt,
        repo: '',
      },
      subtask,
    );

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await reactCaller(messages, { tier, model });
    const parsed = ToolCallParser.parse(response.content);

    if (parsed.toolCalls && parsed.toolCalls.length > 0) {
      return parsed.toolCalls;
    }
    if (parsed.toolCall) {
      return [parsed.toolCall];
    }
    return [];
  };
}
