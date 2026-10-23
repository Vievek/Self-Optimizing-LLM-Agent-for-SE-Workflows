import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FixtureSandboxService } from '@soa/sandbox';
import {
  TraceSpanSchema,
  PromptSpanAttributesSchema,
  ToolCallSpanAttributesSchema,
} from '@soa/contracts';
import { ReactAgent } from './react-agent.js';
import { AgentTask, ToolContext, SubTask } from '../types.js';
import { ReActLlmCaller } from './types.js';

describe('ReactAgent Multi-Turn Reasoning Loop', () => {
  let sandbox: FixtureSandboxService;
  let wsId: string;
  let context: ToolContext;
  let agent: ReactAgent;

  const sampleTask: AgentTask = {
    taskId: 'django__django-11001',
    repo: 'django/django',
    baseCommit: 'a1b2c3d4e5f6',
    problemStatement:
      'Incorrect SQL ordering when RawSQL is used in order_by in django/db/models/sql/compiler.py',
  };

  const sampleSubtask: SubTask = {
    id: 'subtask_1',
    stepIndex: 1,
    type: 'localize',
    goal: 'Locate compiler.py and inspect order_by handling',
    targetFiles: ['django/db/models/sql/compiler.py'],
    estimatedTokens: 1500,
    status: 'pending',
    retryCount: 0,
  };

  beforeEach(async () => {
    sandbox = new FixtureSandboxService();
    wsId = await sandbox.createWorkspace('django__django-11001', 'a1b2c3d4e5f6');
    context = {
      workspaceId: wsId,
      sandbox,
      taskId: sampleTask.taskId,
    };
    agent = new ReactAgent();
  });

  afterEach(async () => {
    if (sandbox && wsId) {
      await sandbox.destroy(wsId);
    }
  });

  it('executes a 2-turn ReAct reasoning loop (Action -> Observation -> Final Answer)', async () => {
    let callCount = 0;
    const llmCaller: ReActLlmCaller = async (messages) => {
      callCount += 1;
      if (callCount === 1) {
        // Turn 1: Model issues tool action
        return {
          content: `Thought: I need to check the files in the current workspace.
Action: list_directory
Action Input: {"path": "."}`,
          tokensIn: 450,
          tokensOut: 65,
          model: 'qwen2.5-coder-7b-instruct',
          provider: 'openai-compat',
        };
      } else {
        // Turn 2: Model sees observation and completes
        const lastMsg = messages[messages.length - 1];
        expect(lastMsg?.role).toBe('user');
        expect(lastMsg?.content).toContain('Observation:');

        return {
          content: `Thought: Found the project structure. Now I have identified compiler.py.
Final Answer: Found django/db/models/sql/compiler.py successfully.`,
          tokensIn: 620,
          tokensOut: 45,
          model: 'qwen2.5-coder-7b-instruct',
          provider: 'openai-compat',
        };
      }
    };

    const result = await agent.executeSubtask({
      task: sampleTask,
      subtask: sampleSubtask,
      context,
      llmCaller,
      tier: 'slm',
      maxTurns: 5,
    });

    expect(result.success).toBe(true);
    expect(result.turns).toBe(2);
    expect(result.toolCallsExecuted).toBe(1);
    expect(result.finalAnswer).toContain('Found django/db/models/sql/compiler.py');
    expect(result.totalTokensIn).toBe(450 + 620);
    expect(result.totalTokensOut).toBe(65 + 45);

    // Verify Spans
    expect(result.spans).toHaveLength(3); // 2 prompt spans + 1 tool_call span

    const promptSpans = result.spans.filter((s) => s.name === 'prompt');
    const toolSpans = result.spans.filter((s) => s.name === 'tool_call');

    expect(promptSpans).toHaveLength(2);
    expect(toolSpans).toHaveLength(1);

    // Verify prompt spans match contracts
    for (const pSpan of promptSpans) {
      expect(TraceSpanSchema.safeParse(pSpan).success).toBe(true);
      expect(PromptSpanAttributesSchema.safeParse(pSpan.attributes).success).toBe(true);
      expect((pSpan.attributes as Record<string, unknown>).model).toBe('qwen2.5-coder-7b-instruct');
    }

    // Verify tool call span matches contracts
    const tSpan = toolSpans[0];
    expect(tSpan).toBeDefined();
    expect(TraceSpanSchema.safeParse(tSpan!).success).toBe(true);
    expect(ToolCallSpanAttributesSchema.safeParse(tSpan!.attributes).success).toBe(true);
    expect((tSpan!.attributes as Record<string, unknown>).tool_name).toBe('list_directory');
  });

  it('stops and reports failure when turn limit is exceeded', async () => {
    // LLM keeps looping without reaching Final Answer
    const loopingCaller: ReActLlmCaller = async () => ({
      content: `Thought: Still exploring directory.
Action: list_directory
Action Input: {"path": "."}`,
      tokensIn: 200,
      tokensOut: 50,
      model: 'qwen2.5-coder-7b-instruct',
      provider: 'openai-compat',
    });

    const result = await agent.executeSubtask({
      task: sampleTask,
      subtask: sampleSubtask,
      context,
      llmCaller: loopingCaller,
      tier: 'slm',
      maxTurns: 3,
    });

    expect(result.success).toBe(false);
    expect(result.turns).toBe(3);
    expect(result.toolCallsExecuted).toBe(3);
    expect(result.lastError).toContain('exceeded maximum turn limit (3)');
  });

  it('recovers gracefully when a tool execution returns an error', async () => {
    let callCount = 0;
    const llmCaller: ReActLlmCaller = async (messages) => {
      callCount += 1;
      if (callCount === 1) {
        // Request invalid file path
        return {
          content: `Thought: Let's read a non-existent file.
Action: read_file
Action Input: {"path": "non_existent_file.xyz"}`,
          tokensIn: 300,
          tokensOut: 40,
        };
      } else {
        // Turn 2: Sees tool error in observation and handles it
        const lastMsg = messages[messages.length - 1];
        expect(lastMsg?.content).toContain('Observation');

        return {
          content: `Thought: The file did not exist, so I will report the missing file.
Final Answer: File non_existent_file.xyz does not exist.`,
          tokensIn: 450,
          tokensOut: 30,
        };
      }
    };

    const result = await agent.executeSubtask({
      task: sampleTask,
      subtask: sampleSubtask,
      context,
      llmCaller,
      tier: 'slm',
      maxTurns: 4,
    });

    expect(result.success).toBe(true);
    expect(result.turns).toBe(2);
    expect(result.finalAnswer).toContain('does not exist');
  });

  it('executes multiple tool calls in a single turn and aggregates observations', async () => {
    let callCount = 0;
    const llmCaller: ReActLlmCaller = async (messages) => {
      callCount += 1;
      if (callCount === 1) {
        // Model requests two tool calls simultaneously using XML syntax
        return {
          content: `Thought: I will list the directory and read a file together.
<tool_call>
<list_directory>
<parameter=path>
.
</parameter>
</function>
</tool_call>
<tool_call>
<write_file>
<parameter=path>
test_batch.txt
</parameter>
<parameter=content>
batch hello
</parameter>
</function>
</tool_call>`,
          tokensIn: 300,
          tokensOut: 60,
        };
      } else {
        const lastMsg = messages[messages.length - 1];
        expect(lastMsg?.content).toContain('Multi-Tool Results');
        expect(lastMsg?.content).toContain('list_directory');
        expect(lastMsg?.content).toContain('write_file');

        return {
          content: `Thought: Both actions completed in one turn.
Final Answer: Multi-tool batch execution verified successfully.`,
          tokensIn: 500,
          tokensOut: 30,
        };
      }
    };

    const result = await agent.executeSubtask({
      task: sampleTask,
      subtask: sampleSubtask,
      context,
      llmCaller,
      tier: 'slm',
      maxTurns: 5,
    });

    expect(result.success).toBe(true);
    expect(result.turns).toBe(2);
    expect(result.toolCallsExecuted).toBe(2);
    expect(result.finalAnswer).toContain('Multi-tool batch execution verified');

    // Verify 2 tool_call spans were recorded, both valid
    const toolSpans = result.spans.filter((s) => s.name === 'tool_call');
    expect(toolSpans).toHaveLength(2);
    for (const tSpan of toolSpans) {
      expect(TraceSpanSchema.safeParse(tSpan).success).toBe(true);
      expect(ToolCallSpanAttributesSchema.safeParse(tSpan.attributes).success).toBe(true);
    }
  });

  it('detects duplicate inspections and injects an active steering notice', async () => {
    let callCount = 0;
    let sawSteeringNotice = false;

    const llmCaller: ReActLlmCaller = async (messages) => {
      callCount += 1;
      const lastMsg = messages[messages.length - 1];

      if (lastMsg?.content.includes('STEERING NOTICE')) {
        sawSteeringNotice = true;
      }

      if (callCount === 1) {
        return {
          content: 'Thought: Listing root dir.\nAction: list_directory\nAction Input: {"path": "."}',
          tokensIn: 300,
          tokensOut: 40,
        };
      } else if (callCount === 2) {
        // Redundant duplicate call
        return {
          content: 'Thought: Listing root dir again.\nAction: list_directory\nAction Input: {"path": "."}',
          tokensIn: 400,
          tokensOut: 40,
        };
      } else {
        // Turn 3: Sees steering notice and finishes
        return {
          content: 'Thought: Steering notice received. Proceeding.\nFinal Answer: Done.',
          tokensIn: 500,
          tokensOut: 30,
        };
      }
    };

    const result = await agent.executeSubtask({
      task: sampleTask,
      subtask: sampleSubtask,
      context,
      llmCaller,
      tier: 'slm',
      maxTurns: 5,
    });

    expect(result.success).toBe(true);
    expect(sawSteeringNotice).toBe(true);
  });
});
