import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProviderRegistry, LlmProvider, ChatRequest, ChatResponse } from '@soa/llm';
import { FixtureSandboxService } from '@soa/sandbox';
import { TraceSpanSchema, OutcomeEvidenceSchema } from '@soa/contracts';
import { createReActLlmCaller, createSubtaskToolCaller } from './llm-bridge.js';
import { AgentRunner } from './agent-runner.js';
import { AgentTask, ToolContext } from './types.js';

class MockLlmProvider implements LlmProvider {
  public recordedRequests: ChatRequest[] = [];
  private readonly defaultContent: string;
  private readonly name: string;

  constructor(name: string, defaultContent: string = 'Final Answer: Done') {
    this.name = name;
    this.defaultContent = defaultContent;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.recordedRequests.push(req);
    return {
      content: this.defaultContent,
      tokensIn: 250,
      tokensOut: 50,
      model: req.model,
      provider: this.name,
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0.1, 0.2, 0.3]);
  }
}

describe('LLM Bridge & Dual Provider Dispatch', () => {
  let registry: ProviderRegistry;
  let smallProvider: MockLlmProvider;
  let largeProvider: MockLlmProvider;

  beforeEach(() => {
    registry = new ProviderRegistry({
      small: { provider: 'openai_compat', model: 'gemini-2.5-flash', baseUrl: 'https://test.api' },
      large: { provider: 'openai_compat', model: 'gemini-2.5-pro', baseUrl: 'https://test.api' },
      embed: {
        provider: 'openai_compat',
        model: 'text-embedding-004',
        baseUrl: 'https://test.api',
      },
    });

    smallProvider = new MockLlmProvider(
      'small-mock',
      `Thought: Running small model exploration.
Action: list_directory
Action Input: {"path": "."}`,
    );
    largeProvider = new MockLlmProvider(
      'large-mock',
      `Thought: Running large model code generation.
Final Answer: Subtask completed successfully by large model.`,
    );

    registry.setProvider('small', smallProvider);
    registry.setProvider('large', largeProvider);
  });

  it('routes slm requests to the small provider and llm requests to the large provider', async () => {
    const caller = createReActLlmCaller({ registry });

    // 1. Invoke SLM tier
    const slmResponse = await caller([{ role: 'user', content: 'Explore files' }], { tier: 'slm' });
    expect(slmResponse.provider).toBe('small-mock');
    expect(slmResponse.model).toBe('gemini-2.5-flash');
    expect(smallProvider.recordedRequests).toHaveLength(1);
    expect(largeProvider.recordedRequests).toHaveLength(0);

    // 2. Invoke LLM tier
    const llmResponse = await caller([{ role: 'user', content: 'Generate code' }], { tier: 'llm' });
    expect(llmResponse.provider).toBe('large-mock');
    expect(llmResponse.model).toBe('gemini-2.5-pro');
    expect(largeProvider.recordedRequests).toHaveLength(1);
  });

  it('createSubtaskToolCaller parses single-turn tool calls correctly', async () => {
    const toolCaller = createSubtaskToolCaller({ registry });

    const calls = await toolCaller(
      'Fix SQL bug',
      {
        id: 'subtask_1',
        stepIndex: 0,
        type: 'explore',
        goal: 'List files',
        targetFiles: [],
        estimatedTokens: 100,
        status: 'pending',
        retryCount: 0,
      },
      'slm',
      'gemini-2.5-flash',
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.toolName).toBe('list_directory');
    expect(calls[0]?.args).toEqual({ path: '.' });
  });

  describe('AgentRunner with ProviderRegistry E2E Verification', () => {
    let sandbox: FixtureSandboxService;
    let wsId: string;
    let context: ToolContext;

    const sampleTask: AgentTask = {
      taskId: 'flask__flask-2000',
      repo: 'pallets/flask',
      baseCommit: 'b1c2d3e4',
      problemStatement: 'Fix blueprint route registration in flask/blueprints.py',
    };

    beforeEach(async () => {
      sandbox = new FixtureSandboxService();
      wsId = await sandbox.createWorkspace('flask__flask-2000', 'b1c2d3e4');
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

    it('orchestrates end-to-end task execution using ProviderRegistry with prompt and tool telemetry', async () => {
      let turnCount = 0;
      const dynamicProvider: LlmProvider = {
        async chat(req: ChatRequest): Promise<ChatResponse> {
          turnCount += 1;
          const lastMsg = req.messages[req.messages.length - 1];

          // If last message is an observation, complete
          if (lastMsg?.content.includes('Observation:')) {
            return {
              content: 'Final Answer: Done with this subtask.',
              tokensIn: 320,
              tokensOut: 25,
              model: req.model,
              provider: 'dynamic-mock',
            };
          }

          return {
            content: `Thought: Checking directory.
Action: list_directory
Action Input: {"path": "."}`,
            tokensIn: 180,
            tokensOut: 40,
            model: req.model,
            provider: 'dynamic-mock',
          };
        },
        async embed(texts: string[]): Promise<number[][]> {
          return texts.map(() => [0.1]);
        },
      };

      registry.setProvider('small', dynamicProvider);
      registry.setProvider('large', dynamicProvider);

      const runner = new AgentRunner();
      const result = await runner.run(sampleTask, context, {
        providerRegistry: registry,
        maxIterations: 10,
      });

      expect(result.resolved).toBe(true);
      expect(turnCount).toBeGreaterThan(0);
      expect(result.spans.length).toBeGreaterThan(6);

      // Verify all spans conform to TraceSpanSchema
      for (const span of result.spans) {
        const parsed = TraceSpanSchema.safeParse(span);
        expect(parsed.success).toBe(true);
      }

      // Check for prompt spans emitted during execution
      const promptSpans = result.spans.filter((s) => s.name === 'prompt');
      expect(promptSpans.length).toBeGreaterThan(0);

      // Check OutcomeEvidence contract
      const evidenceParsed = OutcomeEvidenceSchema.safeParse(result.outcomeEvidence);
      expect(evidenceParsed.success).toBe(true);
      expect(result.outcomeEvidence.cost.tokens_in).toBeGreaterThan(0);
      expect(result.outcomeEvidence.cost.tokens_out).toBeGreaterThan(0);
    });
  });
});
