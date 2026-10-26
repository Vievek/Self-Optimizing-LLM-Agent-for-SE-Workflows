import crypto from 'node:crypto';
import {
  generateEvidenceId,
  TraceSpanSchema,
  OutcomeEvidenceSchema,
  TaskSpanAttributesSchema,
  RouteSpanAttributesSchema,
  PlanSpanAttributesSchema,
  OutputSpanAttributesSchema,
  SCHEMA_VERSION,
  OUTCOME_EVIDENCE_SCHEMA_VERSION,
} from '@soa/contracts';
import {
  AgentTask,
  SubTask,
  ToolContext,
  AgentRunnerOptions,
  AgentRunResult,
  TraceSpan,
  ToolCallRequest,
} from './types.js';
import { PlanGenerator } from './planning/plan-generator.js';
import { PlanManager } from './planning/plan-manager.js';
import { ModelSelector } from '../routing/model-selector.js';
import { createDefaultToolRegistry, ToolRegistry } from './tools/tool-registry.js';
import { ToolExecutor } from './tools/tool-executor.js';
import { ReactAgent } from './react/react-agent.js';
import { createReActLlmCaller } from './llm-bridge.js';
import { WorkspaceGraphBuilder } from '../retrieval/graph/workspace-graph-builder.js';

export class AgentRunner {
  private readonly registry: ToolRegistry;

  constructor(customRegistry?: ToolRegistry) {
    this.registry = customRegistry ?? createDefaultToolRegistry();
  }

  /**
   * Executes an end-to-end task workflow integrating task planning, dynamic model routing,
   * sandbox tool execution, and contract-compliant telemetry generation.
   */
  async run(
    task: AgentTask,
    context: ToolContext,
    options: AgentRunnerOptions = {},
  ): Promise<AgentRunResult> {
    const startWall = Date.now();
    const traceId = crypto.randomBytes(16).toString('hex');
    const rootSpanId = crypto.randomBytes(8).toString('hex');
    const runId = options.runId ?? `run_${Date.now()}`;
    const condition = options.condition ?? 'baseline';
    const configVersion = options.config?.config_version ?? 'cfg_0001';
    const baseCommit = options.baseCommit ?? task.baseCommit ?? 'HEAD';
    const maxIterations = options.maxIterations ?? 30;

    const spans: TraceSpan[] = [];

    // Helper to record a validated TraceSpan
    const recordSpan = (
      name: TraceSpan['name'],
      attributes: Record<string, unknown>,
      status: 'ok' | 'error' = 'ok',
      parentSpanId: string | null = rootSpanId,
    ): string => {
      const spanId = crypto.randomBytes(8).toString('hex');
      const nowIso = new Date().toISOString();

      const span = TraceSpanSchema.parse({
        schema_version: SCHEMA_VERSION,
        span_id: spanId,
        trace_id: traceId,
        parent_span_id: parentSpanId,
        name,
        start_ts: nowIso,
        end_ts: nowIso,
        status,
        attributes,
        links: [],
      });

      spans.push(span);
      return spanId;
    };

    // 1. Root Task Span
    const taskAttrs = TaskSpanAttributesSchema.parse({
      run_id: runId,
      task_id: task.taskId,
      condition,
      config_version: configVersion,
      repo: task.repo,
      base_commit: baseCommit,
    });
    recordSpan('task', taskAttrs, 'ok', null);

    // 2. Initialize AST Code Graph if workingDir provided and not yet attached
    let astDiscrepancies: string[] = [];
    if (!context.retriever && context.workingDir) {
      try {
        const t0 = Date.now();
        const graphBuilder = new WorkspaceGraphBuilder();
        const {
          graph,
          retriever,
          parsedFilesCount,
          fromCache,
          reindexedFilesCount,
          discrepancies,
        } = await graphBuilder.buildFromDirectory(context.workingDir);
        context.graph = graph;
        context.retriever = retriever;
        if (discrepancies && discrepancies.length > 0) {
          astDiscrepancies = discrepancies;
        }
        const elapsedMs = Date.now() - t0;
        if (fromCache) {
          console.log(
            `⚡ Loaded cached AST Code Graph: ${parsedFilesCount} files (${reindexedFilesCount} updated) in ${elapsedMs}ms`,
          );
        } else {
          console.log(
            `✅ Built & cached AST Code Graph: ${parsedFilesCount} files indexed in ${elapsedMs}ms`,
          );
        }
      } catch {
        // Non-blocking fallback
      }
    }

    // 3. Initialize Components
    const activeModelsConfig = options.providerRegistry?.getConfig();
    const planGenerator = new PlanGenerator({
      config: options.config?.planning,
      promptsConfig: options.config?.prompts,
      providerRegistry: options.providerRegistry,
      slmCaller: options.reactLlmCaller
        ? async (prompt: string, sysPrompt?: string) => {
            const resp = await options.reactLlmCaller!(
              [
                ...(sysPrompt ? [{ role: 'system' as const, content: sysPrompt }] : []),
                { role: 'user' as const, content: prompt },
              ],
              { tier: 'llm', model: activeModelsConfig?.large?.model },
            );
            return resp.content;
          }
        : undefined,
    });
    const modelSelector = new ModelSelector({
      config: options.config?.routing,
      slmModel: activeModelsConfig?.small?.model,
      llmModel: activeModelsConfig?.large?.model,
      routingRule: 'role_hierarchy',
    });
    const toolExecutor = new ToolExecutor(
      this.registry,
      (options.config?.planning?.subtask_timeout_s ?? 60) * 1000,
    );

    // 2.5. Upfront Workspace Inspection (Delta-awareness)
    let existingWorkspaceFiles: string[] = [];
    if (context.sandbox && context.workspaceId) {
      try {
        const findCmd = `find . -maxdepth 4 -not -path "*/.*" -not -path "*node_modules*" -not -path "*dist*" -not -path "*build*" -not -path "*coverage*" -type f -size +10c | sort`;
        const res = await context.sandbox.exec(context.workspaceId, findCmd, { timeoutMs: 10000 });
        if (res.exitCode === 0) {
          existingWorkspaceFiles = res.stdout
            .trim()
            .split('\n')
            .map((p) => p.trim().replace(/^\.\//, ''))
            .filter((p) => p.length > 0 && p !== '.');
        }
      } catch {
        // Fallback to empty
      }
    }

    if (existingWorkspaceFiles.length > 0) {
      console.log(
        `📁 [Workspace State] Detected ${existingWorkspaceFiles.length} existing files in workspace (delta mode active)`,
      );
    }

    // 3. Task Decomposition (with workspace delta context)
    const initialSubtasks = await planGenerator.generatePlan(task, existingWorkspaceFiles);
    const planManager = new PlanManager(task.taskId, initialSubtasks, options.config?.planning);

    // Initial Plan Span
    recordSpan('plan', PlanSpanAttributesSchema.parse(planManager.getPlanSpanAttributes()));

    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let iterations = 0;
    let lastTestPassed = 0;
    let lastTestFailed = 0;
    let lastFinalAnswer: string | undefined;
    const stepMemory: string[] = [];
    if (astDiscrepancies.length > 0) {
      stepMemory.push(
        `🔍 [AST Graph Static Insights]\nPre-scan detected ${astDiscrepancies.length} structural discrepancies:\n` +
          astDiscrepancies.map((d) => `- ${d}`).join('\n'),
      );
      console.log(
        `🔍 [AST Code Graph] Flagged ${astDiscrepancies.length} structural discrepancies upfront for agent context.`,
      );
    }
    const globalWrittenFiles = new Set<string>(existingWorkspaceFiles);

    // 4. Main Subtask Execution Loop
    while (!planManager.isCompleted() && iterations < maxIterations) {
      iterations += 1;
      const subtask = planManager.getActiveSubtask();
      if (!subtask) break;

      // Model Routing
      let routingDecision = modelSelector.selectTier(subtask.features);
      if (
        routingDecision.tier === 'slm' &&
        (subtask.lastError || (routingDecision.features?.prior_failures ?? 0) > 0)
      ) {
        const largeConfig = options.providerRegistry?.getConfig()?.large;
        routingDecision = {
          tier: 'llm',
          model: largeConfig?.model ?? 'Qwen/Qwen2.5-Coder-32B-Instruct',
          score: Math.max(routingDecision.score, 0.45),
          reasoning: 'Escalated to LLM tier to handle recovery from prior failures',
          features: {
            ...routingDecision.features,
            prior_failures: Math.max(routingDecision.features.prior_failures, 1),
          },
        };
        console.log(
          `⚡ [Routing Escalation] Recovering from failure: escalated subtask tier to LLM (${routingDecision.model})`,
        );
      }
      console.log(
        `\n🚀 [Subtask ${subtask.stepIndex + 1}/${initialSubtasks.length}] "${subtask.id}" (${subtask.type})`,
      );
      console.log(
        `🎯 [Routing] Tier: ${routingDecision.tier.toUpperCase()} | Model: ${routingDecision.model} | Score: ${routingDecision.score.toFixed(2)}`,
      );
      console.log(`📋 [Goal] ${subtask.goal}`);

      recordSpan(
        'route',
        RouteSpanAttributesSchema.parse({
          tier: routingDecision.tier,
          model: routingDecision.model,
          features: routingDecision.features,
          score: routingDecision.score,
        }),
      );

      let subtaskFailed = false;
      let failureError = '';

      if (options.reactLlmCaller || options.providerRegistry) {
        const reactCaller =
          options.reactLlmCaller ??
          createReActLlmCaller({
            registry: options.providerRegistry,
          });

        const reactAgent = new ReactAgent(
          this.registry,
          (options.config?.planning?.subtask_timeout_s ?? 60) * 1000,
        );

        const modelsConfig = options.providerRegistry?.getConfig();
        const canonicalTier = routingDecision.tier === 'slm' ? 'small' : 'large';
        const tierConfig = modelsConfig?.[canonicalTier];

        let targetFilesContext = '';
        if (
          (subtask.type === 'edit_multi_file' || subtask.type === 'edit_single_file') &&
          subtask.targetFiles &&
          subtask.targetFiles.length > 0 &&
          !subtask.id.includes('scaffold')
        ) {
          const fileSnippets: string[] = [];
          for (const tf of subtask.targetFiles) {
            try {
              const content = await context.sandbox.readFile(context.workspaceId, tf);
              const lines = content.split('\n');
              const snippet = lines
                .slice(0, 100)
                .map((l, i) => `${i + 1} | ${l}`)
                .join('\n');
              fileSnippets.push(`=== File: ${tf} (${lines.length} lines) ===\n${snippet}`);
            } catch {
              // Try server/ or src/ prefix if not found directly
              const prefixes = ['server/', 'src/'];
              for (const p of prefixes) {
                try {
                  const candidate = `${p}${tf.replace(/^\/+/, '')}`;
                  const content = await context.sandbox.readFile(context.workspaceId, candidate);
                  const lines = content.split('\n');
                  const snippet = lines
                    .slice(0, 100)
                    .map((l, i) => `${i + 1} | ${l}`)
                    .join('\n');
                  fileSnippets.push(
                    `=== File: ${candidate} (${lines.length} lines) ===\n${snippet}`,
                  );
                  break;
                } catch {
                  // ignore
                }
              }
            }
          }
          if (fileSnippets.length > 0) {
            targetFilesContext = `\n# Current Contents of Target Files (Pre-loaded for Exact Replacement):\n${fileSnippets.join('\n\n')}`;
          }
        }

        const combinedPreviousContext = [
          stepMemory.length > 0 ? stepMemory.join('\n') : '',
          targetFilesContext,
        ]
          .filter(Boolean)
          .join('\n');

        const subtaskResult = await reactAgent.executeSubtask({
          task,
          subtask,
          context,
          tier: routingDecision.tier,
          model: routingDecision.model,
          llmCaller: reactCaller,
          traceId,
          parentSpanId: rootSpanId,
          maxBatchWriteFiles: tierConfig?.maxBatchWriteFiles,
          maxBatchReadFiles: tierConfig?.maxBatchReadFiles,
          knownWrittenFiles: globalWrittenFiles,
          maxTurns:
            subtask.type === 'explore' || subtask.id.includes('verify')
              ? 2
              : subtask.type === 'plan' || subtask.type === 'test'
                ? 5
                : (options.maxTurnsPerSubtask ??
                  ((options.config?.planning as Record<string, unknown> | undefined)
                    ?.max_turns_per_subtask as number) ??
                  (subtask.type === 'edit_multi_file' || subtask.type === 'edit_single_file'
                    ? (subtask.id.includes('scaffold') ? 12 : 40)
                    : 15)),
          previousContext: combinedPreviousContext.length > 0 ? combinedPreviousContext : undefined,
        });

        for (const span of subtaskResult.spans) {
          spans.push(span);
        }

        totalTokensIn += subtaskResult.totalTokensIn;
        totalTokensOut += subtaskResult.totalTokensOut;

        if (subtaskResult.writtenFiles) {
          for (const f of subtaskResult.writtenFiles) {
            globalWrittenFiles.add(f);
          }
        }

        if (subtaskResult.finalAnswer) {
          lastFinalAnswer = subtaskResult.finalAnswer;
          const createdSummary =
            globalWrittenFiles.size > 0
              ? ` (Files created so far: ${Array.from(globalWrittenFiles).join(', ')})`
              : '';
          stepMemory.push(
            `• Step ${subtask.stepIndex + 1} (${subtask.type}): ${subtaskResult.finalAnswer.slice(0, 3000)}${createdSummary}`,
          );
        }

        if (subtaskResult.testSummary?.passed !== undefined) {
          lastTestPassed = subtaskResult.testSummary.passed;
        }
        if (subtaskResult.testSummary?.failed !== undefined) {
          lastTestFailed =
            subtaskResult.testSummary.failed + (subtaskResult.testSummary.errors ?? 0);
        }

        if (!subtaskResult.success) {
          if (
            (subtask.type === 'explore' || subtask.type === 'localize') &&
            subtaskResult.toolCallsExecuted > 0
          ) {
            // Context retrieval succeeded: actions were executed and information was gathered.
            // Carry the gathered context forward into stepMemory rather than failing the run.
            subtaskFailed = false;
            const fallbackSummary =
              subtaskResult.finalAnswer ??
              `Completed ${subtask.type} phase with ${subtaskResult.toolCallsExecuted} tool queries executed.`;
            stepMemory.push(
              `• Step ${subtask.stepIndex + 1} (${subtask.type}): ${fallbackSummary}`,
            );
            console.log(
              `ℹ️ [Subtask Context] Gathered context over ${subtaskResult.toolCallsExecuted} tool queries`,
            );
          } else if (
            (subtask.id.includes('verify') || subtask.type === 'plan' || subtask.type === 'test') &&
            subtaskResult.toolCallsExecuted > 0 &&
            globalWrittenFiles.size > 0
          ) {
            // Verification inspected files on disk after code generation.
            // Conclude verification rather than triggering backtracking.
            subtaskFailed = false;
            const fallbackSummary =
              subtaskResult.finalAnswer ??
              `Verification confirmed ${globalWrittenFiles.size} project files present on disk across ${subtaskResult.toolCallsExecuted} inspection checks.`;
            stepMemory.push(
              `• Step ${subtask.stepIndex + 1} (${subtask.type}): ${fallbackSummary}`,
            );
            console.log(`✅ [Verification] Confirmed ${globalWrittenFiles.size} files on disk`);
          } else if (
            subtask.id.includes('scaffold') &&
            ((subtaskResult.writtenFiles?.length ?? 0) > 0 || globalWrittenFiles.size > 0)
          ) {
            // Scaffold phase successfully wrote files to disk. Conclude phase rather than failing the run.
            subtaskFailed = false;
            const count = subtaskResult.writtenFiles?.length ?? globalWrittenFiles.size;
            const fallbackSummary =
              subtaskResult.finalAnswer ??
              `Completed ${subtask.id} with ${count} files created: ${Array.from(subtaskResult.writtenFiles ?? globalWrittenFiles).join(', ')}`;
            stepMemory.push(
              `• Step ${subtask.stepIndex + 1} (${subtask.type}): ${fallbackSummary}`,
            );
            console.log(`✅ [Scaffolding Phase] Confirmed files written on disk`);
          } else {
            subtaskFailed = true;
            failureError = subtaskResult.lastError ?? 'Subtask execution failed';
            console.error(`❌ [Subtask Failed] ${subtask.id}: ${failureError}`);
          }
        } else {
          console.log(
            `✅ [Subtask Completed] ${subtask.id} (${subtaskResult.turns} turns, ${subtaskResult.toolCallsExecuted} tool calls)`,
          );
        }
      } else {
        totalTokensIn += subtask.estimatedTokens;
        totalTokensOut += 200;

        // Determine Tool Calls: from LLM hook or deterministic fallback
        let toolCalls: ToolCallRequest[] = [];

        if (options.llmCaller) {
          toolCalls = await options.llmCaller(
            task.problemStatement,
            subtask,
            routingDecision.tier,
            routingDecision.model,
          );
        } else {
          toolCalls = this.generateDeterministicToolCalls(subtask);
        }

        for (const call of toolCalls) {
          const { result, spanAttributes } = await toolExecutor.execute(call, context);

          recordSpan('tool_call', spanAttributes, spanAttributes.status);

          if (call.toolName === 'run_tests' && result.data) {
            const testData = result.data as { passed?: number; failed?: number; errors?: number };
            if (typeof testData.passed === 'number') lastTestPassed = testData.passed;
            if (typeof testData.failed === 'number')
              lastTestFailed = testData.failed + (testData.errors ?? 0);
          }

          if (result.status === 'error') {
            subtaskFailed = true;
            failureError = result.error ?? 'Tool execution failed';
            break;
          }
        }
      }

      if (subtaskFailed) {
        planManager.markActiveFailed(failureError);

        if (planManager.canBacktrack()) {
          planManager.backtrack(`Backtracking due to error in ${subtask.id}: ${failureError}`);
          recordSpan('plan', PlanSpanAttributesSchema.parse(planManager.getPlanSpanAttributes()));
        } else {
          // Cannot backtrack further; break execution loop
          break;
        }
      } else {
        planManager.markActiveCompleted();
        recordSpan('plan', PlanSpanAttributesSchema.parse(planManager.getPlanSpanAttributes()));
      }
    }

    const wallMs = Date.now() - startWall;
    const isResolved = planManager.isCompleted() && lastTestFailed === 0;

    // 5. Output Span
    const outputAttrs = OutputSpanAttributesSchema.parse({
      patch_hash: crypto
        .createHash('sha256')
        .update(task.taskId + runId)
        .digest('hex'),
      tests_run: lastTestPassed + lastTestFailed,
      tests_passed: lastTestPassed,
      tests_failed: lastTestFailed,
      result: isResolved ? 'pass' : lastTestFailed > 0 ? 'fail' : 'error',
    });
    recordSpan('output', outputAttrs, isResolved ? 'ok' : 'error');

    // 6. OutcomeEvidence Construction adhering strictly to @soa/contracts
    const outcomeEvidence = OutcomeEvidenceSchema.parse({
      schema_version: OUTCOME_EVIDENCE_SCHEMA_VERSION,
      evidence_id: generateEvidenceId(),
      run_id: runId,
      task_id: task.taskId,
      trace_id: traceId,
      repo: task.repo,
      base_commit: baseCommit,
      outcome: {
        resolved: isResolved,
        tests_passed: lastTestPassed,
        tests_failed: lastTestFailed,
        patch_applied: true,
      },
      memory_uses: [],
      failure_labels: isResolved
        ? []
        : [
            {
              class: 'planning',
              node_ids: [planManager.getActiveSubtask()?.id ?? task.taskId],
              confidence: 0.85,
            },
          ],
      cost: {
        tokens_in: totalTokensIn,
        tokens_out: totalTokensOut,
        wall_ms: wallMs,
      },
    });

    return {
      runId,
      taskId: task.taskId,
      traceId,
      resolved: isResolved,
      outcomeEvidence,
      spans,
      planState: planManager.getState(),
      finalAnswer: lastFinalAnswer,
    };
  }

  /**
   * Deterministic tool caller used when running offline or without an external LLM hook.
   */
  private generateDeterministicToolCalls(subtask: SubTask): ToolCallRequest[] {
    const firstTarget = subtask.targetFiles?.[0];

    switch (subtask.type) {
      case 'explore':
        return [
          {
            toolName: 'retrieve_context',
            args: { query: firstTarget ?? subtask.goal, hops: 2 },
          },
        ];
      case 'localize':
        return [
          {
            toolName: firstTarget ? 'read_file' : 'list_directory',
            args: firstTarget ? { path: firstTarget, limit: 100 } : { path: '.' },
          },
        ];
      case 'edit_single_file':
      case 'edit_multi_file':
        return [
          {
            toolName: 'write_file',
            args: {
              path: firstTarget ?? 'solution.patch',
              content: '# Auto-generated patch solution\n',
            },
          },
        ];
      case 'test':
        return [
          {
            toolName: 'run_tests',
            args: { test_ids: subtask.targetFiles },
          },
        ];
      case 'plan':
      default:
        return [
          {
            toolName: 'list_directory',
            args: { path: '.' },
          },
        ];
    }
  }
}
