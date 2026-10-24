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
    const isCodeGen =
      params.subtask.type === 'edit_multi_file' || params.subtask.type === 'edit_single_file';
    const maxTurns = params.maxTurns ?? (isCodeGen ? 40 : 10);
    const traceId = params.traceId ?? crypto.randomBytes(16).toString('hex');
    const parentSpanId = params.parentSpanId ?? null;

    const spans: TraceSpan[] = [];
    const isGroq = Boolean(process.env.GROQ_API_KEY);
    const writtenFiles = new Set<string>(params.knownWrittenFiles ?? []);
    const historyManager =
      params.historyManager ??
      new ConversationHistoryManager(
        tier,
        isGroq
          ? { maxTotalTokens: 5500, reservedOutputTokens: 1000 }
          : tier === 'slm'
            ? { maxTotalTokens: 5500 }
            : undefined,
      );

    // Initialize conversation history if new
    if (historyManager.getMessages().length === 0) {
      const isScaffold = params.subtask.id.includes('scaffold');
      const promptBuilder = new PromptBuilder({
        maxBatchWriteFiles: params.maxBatchWriteFiles,
        maxBatchReadFiles: params.maxBatchReadFiles,
        customGuidelines: [
          'Think step-by-step before selecting an action.',
          'You may call multiple tools or batch actions in one turn if needed to gather context or make changes efficiently.',
          isScaffold
            ? 'For scaffolding subtasks, write the required files with write_file and conclude immediately without calling read_file; full verification is reserved for the final verification step.'
            : 'Always verify files and test outcomes before concluding.',
        ],
      });

      const systemPrompt = params.systemPrompt ?? promptBuilder.buildSystemPrompt();
      const userPrompt = promptBuilder.buildSubtaskPrompt(
        params.task,
        params.subtask,
        params.previousContext,
      );

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
    const inspectionHistory: Array<{ tool: string; args: string }> = [];
    let consecutiveInspections = 0;
    let turnsWithoutProgress = 0;
    let previousWrittenCount = writtenFiles.size;

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

      if (parsed.thought) {
        const preview = parsed.thought.split('\n')[0]?.trim();
        console.log(
          `💭 [Turn ${turn}/${maxTurns}] ${preview ? preview.slice(0, 100) : 'Thinking...'}`,
        );
      }

      if (parsed.isFinal) {
        success = true;
        finalAnswer = parsed.finalAnswer ?? parsed.thought ?? response.content;
        console.log(`\n🏁 [Final Answer]\n${finalAnswer}\n`);
        break;
      }

      const callsToExecute =
        parsed.toolCalls && parsed.toolCalls.length > 0
          ? parsed.toolCalls
          : parsed.toolCall
            ? [parsed.toolCall]
            : [];

      if (callsToExecute.length > 0) {
        const observationSections: string[] = [];

        for (const call of callsToExecute) {
          if (
            (params.subtask.id.includes('explain') ||
              params.subtask.id.includes('audit') ||
              params.subtask.goal.includes('Do NOT edit files')) &&
            (call.toolName === 'write_file' || call.toolName === 'edit_file')
          ) {
            observationSections.push(
              `Observation (${call.toolName}): Forbidden in explain/audit read-only mode. Do NOT modify or write files. Please conclude with your architectural analysis and bug report in Final Answer.`,
            );
            continue;
          }

          const toolStartIso = new Date().toISOString();
          const { result, spanAttributes } = await this.toolExecutor.execute(call, params.context);
          const toolEndIso = new Date().toISOString();
          toolCallsExecuted += 1;
          console.log(
            `🔧 [Tool: ${call.toolName}] -> ${result.status} (${result.latencyMs ?? 0}ms)`,
          );

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

          if (call.toolName === 'run_tests' && result.data) {
            lastTestSummary = result.data as { passed?: number; failed?: number; errors?: number };
          }

          const compactedObs = compactToolOutput(result.output, call.toolName);
          if (callsToExecute.length === 1) {
            observationSections.push(
              result.status === 'ok'
                ? `Observation: ${compactedObs}`
                : `Observation (Tool Error): ${result.error ?? compactedObs}`,
            );
          } else {
            const label = `${call.toolName}(${JSON.stringify(call.args)})`;
            observationSections.push(
              result.status === 'ok'
                ? `--- [Result: ${label}] ---\n${compactedObs}`
                : `--- [Error: ${label}] ---\n${result.error ?? compactedObs}`,
            );
          }

          if (result.status === 'ok') {
            if (call.toolName === 'write_file') {
              if (typeof call.args.path === 'string' && call.args.path) {
                writtenFiles.add(call.args.path);
              }
              if (Array.isArray(call.args.files)) {
                for (const f of call.args.files as Array<{ path?: string }>) {
                  if (typeof f?.path === 'string' && f.path) {
                    writtenFiles.add(f.path);
                  }
                }
              }
            } else if (call.toolName === 'edit_file') {
              if (typeof call.args.path === 'string' && call.args.path) {
                writtenFiles.add(call.args.path);
              }
            }
          }

          if (result.status === 'error') {
            lastError = result.error ?? 'Tool execution failed';
          }
        }

        // Active steering: detect repeated inspections or inspection loops
        let loopNotice = '';
        for (const call of callsToExecute) {
          if (call.toolName === 'list_directory' || call.toolName === 'read_file') {
            const argKey = JSON.stringify(call.args);
            const isDuplicate = inspectionHistory.some(
              (h) => h.tool === call.toolName && h.args === argKey,
            );
            consecutiveInspections += 1;
            inspectionHistory.push({ tool: call.toolName, args: argKey });

            if (isDuplicate) {
              loopNotice =
                '\n\n⚠️ STEERING NOTICE: You have already inspected this path. You have sufficient information about the workspace. Do NOT call list_directory or read_file again. Proceed immediately to write the required missing files using write_file.';
            } else if (
              params.subtask.id.includes('scaffold') &&
              call.toolName === 'read_file' &&
              writtenFiles.size > 0
            ) {
              loopNotice =
                '\n\n⚠️ STEERING NOTICE: Target files for this scaffolding phase have already been written. Do NOT call read_file to re-read them; centralized verification will run in the final verification phase. Conclude this subtask now with **Thought** and **Final Answer**.';
            } else if (
              (params.subtask.type === 'edit_multi_file' ||
                params.subtask.type === 'edit_single_file') &&
              call.toolName === 'list_directory' &&
              params.previousContext
            ) {
              loopNotice =
                '\n\n⚠️ STEERING NOTICE: Exploration is already complete. Do NOT call list_directory again. Proceed immediately to write the required missing files using write_file.';
            } else if (consecutiveInspections >= 3) {
              if (
                params.subtask.type === 'localize' ||
                params.subtask.type === 'explore' ||
                params.subtask.type === 'plan' ||
                params.subtask.id.includes('explain') ||
                params.subtask.id.includes('audit')
              ) {
                loopNotice =
                  '\n\n⚠️ STEERING NOTICE: You have gathered sufficient inspection data. Do NOT read or list any more files, and do NOT write or modify any files. Conclude this subtask now by summarizing your architectural analysis, code relationships, and any potential bugs or security flaws in your **Final Answer**.';
              } else {
                loopNotice =
                  '\n\n⚠️ STEERING NOTICE: You have completed exploration. Do NOT read or list any more files. Immediately begin writing the missing project files using write_file.';
              }
            }
          } else if (call.toolName === 'write_file' || call.toolName === 'edit_file') {
            consecutiveInspections = 0;
          }
        }

        // Track forward progress: resetting stagnation if new files are written
        if (writtenFiles.size > previousWrittenCount) {
          turnsWithoutProgress = 0;
          previousWrittenCount = writtenFiles.size;
        } else {
          turnsWithoutProgress += 1;
        }

        let stagnationNotice = '';
        if (turnsWithoutProgress >= 5) {
          stagnationNotice =
            '\n\n⚠️ PROGRESS NOTICE: No new files have been written in the last 5 turns. If all required files for this subtask are complete, conclude immediately with **Thought** and **Final Answer**. Otherwise, proceed to write the next missing file.';
        }
        if (turnsWithoutProgress >= 8) {
          lastError = `Subtask halted after 8 consecutive turns with no new files created or progress made.`;
          break;
        }

        const writtenList = Array.from(writtenFiles);
        const writtenNotice =
          writtenList.length > 0
            ? `\n\n📁 Already Created/Modified Files (${writtenList.length}):\n${writtenList.map((f) => `- ${f}`).join('\n')}\n🚨 DO NOT rewrite or duplicate these files. Only write remaining files that are NOT in this list.`
            : '';

        const promptNote =
          turn >= maxTurns - 2
            ? '\n\nNOTICE: Approaching turn limit. If all required project files are complete, conclude with **Thought** and **Final Answer**.'
            : '';

        const fullObs =
          callsToExecute.length === 1
            ? `${observationSections[0]}${loopNotice}${writtenNotice}${stagnationNotice}${promptNote}`
            : `Observation (Multi-Tool Results):\n${observationSections.join('\n\n')}${loopNotice}${writtenNotice}${stagnationNotice}${promptNote}`;

        historyManager.addMessage('user', fullObs);
      } else {
        // No tool call detected
        if (parsed.finalAnswer) {
          success = true;
          finalAnswer = parsed.finalAnswer;
          break;
        }

        // Check if the model attempted an Action but got cut off or lacked valid tool name
        const hasActionAttempt = /(?:\*{1,2}|#+\s*)?Action(?:\*{1,2})?:/i.test(response.content);
        if (hasActionAttempt) {
          historyManager.addMessage(
            'user',
            'Observation (Invalid Action): An Action was indicated but no valid tool call was recognized. Available tools: read_file, write_file, edit_file, run_command, run_tests, retrieve_context, list_directory, grep_search. Please output Action: <tool_name> followed by Action Input: <json_args>, or state Final Answer if done.',
          );
        } else if (response.content.trim()) {
          // If the model gave a pure conclusion without the literal words "Final Answer:"
          success = true;
          finalAnswer = response.content.trim();
          break;
        } else {
          historyManager.addMessage(
            'user',
            'Please follow the ReAct format: state your Thought and select an Action (with Action Input) to proceed, or state Final Answer if done.',
          );
        }
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
      writtenFiles: Array.from(writtenFiles),
    };
  }
}
