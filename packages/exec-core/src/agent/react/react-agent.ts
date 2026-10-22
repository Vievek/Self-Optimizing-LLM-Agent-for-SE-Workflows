import crypto from 'node:crypto';
import { SCHEMA_VERSION, TraceSpanSchema, PromptSpanAttributesSchema } from '@soa/contracts';
import { TraceSpan } from '../types.js';
import { createDefaultToolRegistry, ToolRegistry } from '../tools/tool-registry.js';
import { ToolExecutor } from '../tools/tool-executor.js';
import { PromptBuilder } from '../prompts/prompt-builder.js';
import { ConversationHistoryManager, compactToolOutput } from '../context/index.js';
import { ToolCallParser } from './tool-call-parser.js';
import { ExecuteSubtaskParams, ExecuteSubtaskResult } from './types.js';

export class ReactAgent {
  private readonly registry: ToolRegistry;
  private readonly toolExecutor: ToolExecutor;

  constructor(customRegistry?: ToolRegistry, timeoutMs: number = 60000) {
    this.registry = customRegistry ?? createDefaultToolRegistry();
    this.toolExecutor = new ToolExecutor(this.registry, timeoutMs);
  }

  /**
   * Executes a single subtask within an iterative Thought -> Action -> Observation loop.
   * Emits telemetry spans for LLM prompts and tool calls in accordance with SOA contracts.
   */
  async executeSubtask(params: ExecuteSubtaskParams): Promise<ExecuteSubtaskResult> {
    const tier = params.tier ?? 'slm';
    const model =
      params.model ?? (tier === 'slm' ? 'qwen2.5-coder-7b-instruct' : 'qwen2.5-coder-32b-instruct');
    const maxTurns = params.maxTurns ?? 6;
    const traceId = params.traceId ?? crypto.randomBytes(16).toString('hex');
    const parentSpanId = params.parentSpanId ?? null;

    const spans: TraceSpan[] = [];
    const historyManager = params.historyManager ?? new ConversationHistoryManager(tier);

    // Initialize conversation history if new
    if (historyManager.getMessages().length === 0) {
      const promptBuilder = new PromptBuilder({
        customGuidelines: [
          'Think step-by-step before selecting an action.',
          'Output exactly one Action and Action Input per step, or Final Answer when complete.',
          'Always verify files and test outcomes before concluding.',
        ],
      });

      const systemPrompt = params.systemPrompt ?? promptBuilder.buildSystemPrompt();
      const userPrompt = promptBuilder.buildSubtaskPrompt(params.task, params.subtask);

      historyManager.addMessage('system', systemPrompt);
      historyManager.addMessage('user', userPrompt);
    }

    let turn = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let toolCallsExecuted = 0;
    let lastTestSummary: { passed?: number; failed?: number; errors?: number } | undefined;
    let lastError: string | undefined;
    let finalAnswer: string | undefined;
    let success = false;

    while (turn < maxTurns) {
      turn += 1;

      // 1. Get tier-budget-constrained compacted messages
      const compactedMessages = historyManager.getCompactedMessages();

      // 2. Invoke LLM
      const promptStartIso = new Date().toISOString();
      const response = await params.llmCaller(compactedMessages, { tier, model });
      const promptEndIso = new Date().toISOString();

      const tokensIn = response.tokensIn ?? 0;
      const tokensOut = response.tokensOut ?? 0;
      totalTokensIn += tokensIn;
      totalTokensOut += tokensOut;

      // 3. Record PromptSpan telemetry conforming to PromptSpanAttributesSchema
      const promptAttrs = PromptSpanAttributesSchema.parse({
        template_id: `subtask_${params.subtask.type}`,
        template_version: '1.0.0',
        model: response.model ?? model,
        provider: response.provider ?? 'openai-compat',
        tokens_in: tokensIn,
        tokens_out: tokensOut,
      });

      const promptSpan = TraceSpanSchema.parse({
        schema_version: SCHEMA_VERSION,
        span_id: crypto.randomBytes(8).toString('hex'),
        trace_id: traceId,
        parent_span_id: parentSpanId,
        name: 'prompt',
        start_ts: promptStartIso,
        end_ts: promptEndIso,
        status: 'ok',
        attributes: promptAttrs,
        links: [],
      });
      spans.push(promptSpan);

      // 4. Append LLM response to conversation history
      historyManager.addMessage('assistant', response.content);

      // 5. Parse response for Thought / Action / Final Answer
      const parsed = ToolCallParser.parse(response.content);

      if (parsed.isFinal) {
        success = true;
        finalAnswer = parsed.finalAnswer ?? parsed.thought ?? response.content;
        break;
      }

      if (parsed.toolCall) {
        const toolStartIso = new Date().toISOString();
        const { result, spanAttributes } = await this.toolExecutor.execute(
          parsed.toolCall,
          params.context,
        );
        const toolEndIso = new Date().toISOString();
        toolCallsExecuted += 1;

        // Record ToolCallSpan telemetry
        const toolSpan = TraceSpanSchema.parse({
          schema_version: SCHEMA_VERSION,
          span_id: crypto.randomBytes(8).toString('hex'),
          trace_id: traceId,
          parent_span_id: parentSpanId,
          name: 'tool_call',
          start_ts: toolStartIso,
          end_ts: toolEndIso,
          status: spanAttributes.status,
          attributes: spanAttributes,
          links: [],
        });
        spans.push(toolSpan);

        if (parsed.toolCall.toolName === 'run_tests' && result.data) {
          lastTestSummary = result.data as { passed?: number; failed?: number; errors?: number };
        }

        // 6. Compact tool observation and record in history
        const compactedObs = compactToolOutput(result.output, parsed.toolCall.toolName);
        const observationText =
          result.status === 'ok'
            ? `Observation: ${compactedObs}`
            : `Observation (Tool Error): ${result.error ?? compactedObs}`;

        historyManager.addMessage('user', observationText);

        if (result.status === 'error') {
          lastError = result.error ?? 'Tool execution failed';
        }
      } else {
        // No tool call and no explicit final answer - treat response as resolution
        success = true;
        finalAnswer = response.content;
        break;
      }
    }

    if (!success && !finalAnswer) {
      lastError =
        lastError ??
        `Subtask ${params.subtask.id} exceeded maximum turn limit (${maxTurns}) without completing.`;
    }

    return {
      success,
      subtask: params.subtask,
      turns: turn,
      totalTokensIn,
      totalTokensOut,
      toolCallsExecuted,
      finalAnswer,
      lastError,
      spans,
      testSummary: lastTestSummary,
    };
  }
}
