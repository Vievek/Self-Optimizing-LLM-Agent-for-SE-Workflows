import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FixtureSandboxService } from '@soa/sandbox';
import { TraceSpanSchema, OutcomeEvidenceSchema } from '@soa/contracts';
import { AgentRunner } from './agent-runner.js';
import { AgentTask, ToolContext, SubTask, ModelTier } from './types.js';

describe('AgentRunner End-to-End Orchestration', () => {
  let sandbox: FixtureSandboxService;
  let wsId: string;
  let runner: AgentRunner;
  let context: ToolContext;

  const sampleTask: AgentTask = {
    taskId: 'django__django-11001',
    repo: 'django/django',
    baseCommit: 'a1b2c3d4e5f6',
    problemStatement:
      'Incorrect SQL ordering when RawSQL is used in order_by in django/db/models/sql/compiler.py and tests/test_compiler.py',
  };

  beforeEach(async () => {
    sandbox = new FixtureSandboxService();
    wsId = await sandbox.createWorkspace('django__django-11001', 'a1b2c3d4e5f6');
    runner = new AgentRunner();
    context = {
      workspaceId: wsId,
      sandbox,
      taskId: sampleTask.taskId,
    };
  });

  afterEach(async () => {
    if (sandbox && wsId) {
      await sandbox.destroy(wsId);
    }
  });

  it('runs complete workflow in deterministic offline mode and produces contract-compliant evidence', async () => {
    const result = await runner.run(sampleTask, context);

    expect(result.runId).toBeDefined();
    expect(result.taskId).toBe(sampleTask.taskId);
    expect(result.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(result.spans.length).toBeGreaterThan(5);

    // Verify all emitted spans strictly adhere to @soa/contracts TraceSpanSchema
    for (const span of result.spans) {
      const spanParsed = TraceSpanSchema.safeParse(span);
      expect(spanParsed.success).toBe(true);
      expect(span.trace_id).toBe(result.traceId);
    }

    // Verify specific span types exist
    const taskSpans = result.spans.filter((s) => s.name === 'task');
    const planSpans = result.spans.filter((s) => s.name === 'plan');
    const routeSpans = result.spans.filter((s) => s.name === 'route');
    const toolSpans = result.spans.filter((s) => s.name === 'tool_call');
    const outputSpans = result.spans.filter((s) => s.name === 'output');

    expect(taskSpans.length).toBe(1);
    expect(planSpans.length).toBeGreaterThanOrEqual(1);
    expect(routeSpans.length).toBeGreaterThanOrEqual(1);
    expect(toolSpans.length).toBeGreaterThanOrEqual(1);
    expect(outputSpans.length).toBe(1);

    // Verify OutcomeEvidence schema compliance
    const evidenceParsed = OutcomeEvidenceSchema.safeParse(result.outcomeEvidence);
    expect(evidenceParsed.success).toBe(true);
    expect(result.outcomeEvidence.evidence_id).toMatch(/^ev_/);
    expect(result.outcomeEvidence.schema_version).toBe('2.0');
    expect(result.outcomeEvidence.task_id).toBe(sampleTask.taskId);
  });

  it('supports custom LLMCaller hook for intelligent tool dispatch', async () => {
    let llmCallCount = 0;

    const mockLlmCaller = async (
      _prompt: string,
      subtask: SubTask,
      _tier: ModelTier,
      _model: string,
    ) => {
      llmCallCount += 1;

      if (subtask.type === 'edit_multi_file' || subtask.type === 'edit_single_file') {
        return [
          {
            toolName: 'write_file',
            args: {
              path: 'solution.py',
              content: 'def fixed(): return True\n',
            },
          },
        ];
      }

      return [
        {
          toolName: 'list_directory',
          args: { path: '.' },
        },
      ];
    };

    const result = await runner.run(sampleTask, context, {
      llmCaller: mockLlmCaller,
    });

    expect(result.planState.subtasks.every((st) => st.status === 'completed')).toBe(true);
    expect(llmCallCount).toBeGreaterThan(0);

    // Verify written file in workspace
    const content = await sandbox.readFile(wsId, 'solution.py');
    expect(content).toContain('def fixed(): return True');
  });

  it('recovers and backtracks when a tool call fails', async () => {
    let attempt = 0;

    const mockFailingLlmCaller = async (_p: string, subtask: SubTask) => {
      // First attempt on edit step fails with invalid tool
      if (subtask.type === 'edit_multi_file' && attempt === 0) {
        attempt += 1;
        return [
          {
            toolName: 'read_file',
            args: { path: 'non_existent_file_that_does_not_exist_404.py' },
          },
        ];
      }

      // Subsequent attempt succeeds
      return [
        {
          toolName: 'list_directory',
          args: { path: '.' },
        },
      ];
    };

    const result = await runner.run(sampleTask, context, {
      llmCaller: mockFailingLlmCaller,
      config: {
        planning: {
          schema_version: '1.0',
          backtrack_depth: 3,
          verify_after_edit: true,
          subtask_timeout_s: 60,
        },
      },
    });

    // Check that at least one plan span contains a replan_reason
    const replanSpans = result.spans.filter(
      (s) => s.name === 'plan' && s.attributes['replan_reason'] !== null,
    );
    expect(replanSpans.length).toBeGreaterThan(0);
  });
});
