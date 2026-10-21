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

    // 2. Initialize Components
    const planGenerator = new PlanGenerator({ config: options.config?.planning });
    const modelSelector = new ModelSelector({ config: options.config?.routing });
    const toolExecutor = new ToolExecutor(
      this.registry,
      (options.config?.planning?.subtask_timeout_s ?? 60) * 1000,
    );

    // 3. Task Decomposition
    const initialSubtasks = await planGenerator.generatePlan(task);
    const planManager = new PlanManager(task.taskId, initialSubtasks, options.config?.planning);

    // Initial Plan Span
    recordSpan('plan', PlanSpanAttributesSchema.parse(planManager.getPlanSpanAttributes()));

    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let iterations = 0;
    let lastTestPassed = 0;
    let lastTestFailed = 0;

    // 4. Main Subtask Execution Loop
    while (!planManager.isCompleted() && iterations < maxIterations) {
      iterations += 1;
      const subtask = planManager.getActiveSubtask();
      if (!subtask) break;

      // Model Routing
      const routingDecision = modelSelector.selectTier(subtask.features);
      recordSpan(
        'route',
        RouteSpanAttributesSchema.parse({
          tier: routingDecision.tier,
          model: routingDecision.model,
          features: routingDecision.features,
          score: routingDecision.score,
        }),
      );

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

      let subtaskFailed = false;
      let failureError = '';

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
