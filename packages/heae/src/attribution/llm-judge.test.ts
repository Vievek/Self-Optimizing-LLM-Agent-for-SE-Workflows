import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { ChatRequest, ChatResponse, LlmProvider } from '@soa/llm';

import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';
import { judgeTrace } from './llm-judge.js';

function makeProvider(content: string): {
  provider: LlmProvider;
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];

  const provider: LlmProvider = {
    async chat(request): Promise<ChatResponse> {
      requests.push(request);

      return {
        content,
        tokensIn: 100,
        tokensOut: 50,
        model: request.model,
        provider: 'mock',
      };
    },

    async embed(): Promise<number[][]> {
      return [];
    },
  };

  return { provider, requests };
}

function loadGraph(path: URL) {
  return buildTraceGraph(parseTraceJsonl(readFileSync(path, 'utf8')));
}

const toolPath = new URL('../../fixtures/tool-error.jsonl', import.meta.url);

const successPath = new URL('../../../../fixtures/traces/success.jsonl', import.meta.url);

function responseJson(category = 'tool', nodeId = '1000000000000006'): string {
  return JSON.stringify({
    findings: [
      {
        category,
        assessment: 'insufficient_evidence',
        explanation: 'A tool error was observed, but causality is uncertain.',
        evidenceNodeIds: [nodeId],
        limitations: ['The originating patch context was not inspected.'],
      },
    ],
    overallUncertainty: 'The available trace does not prove the root cause.',
  });
}

describe('HEAE LLM-as-Judge', () => {
  it('calls the shared provider interface', async () => {
    const { provider, requests } = makeProvider(responseJson());

    const result = await judgeTrace(loadGraph(toolPath), {
      provider,
      model: 'test-judge',
    });

    expect(result.modelCalled).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.model).toBe('test-judge');
    expect(requests[0]?.temperature).toBe(0);
  });

  it('accepts evidence-grounded judgments', async () => {
    const { provider } = makeProvider(responseJson());

    const result = await judgeTrace(loadGraph(toolPath), {
      provider,
      model: 'test-judge',
    });

    expect(result.judgment?.findings[0]?.category).toBe('tool');
    expect(result.judgment?.findings[0]?.assessment).toBe('insufficient_evidence');
  });

  it('skips the model for a clean trace', async () => {
    const { provider, requests } = makeProvider(responseJson());

    const result = await judgeTrace(loadGraph(successPath), {
      provider,
      model: 'test-judge',
    });

    expect(result.modelCalled).toBe(false);
    expect(result.judgment).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('rejects invented evidence IDs', async () => {
    const { provider } = makeProvider(responseJson('tool', 'ffffffffffffffff'));

    await expect(
      judgeTrace(loadGraph(toolPath), {
        provider,
        model: 'test-judge',
      }),
    ).rejects.toThrow('Unverified evidence node');
  });

  it('rejects unsupported categories', async () => {
    const { provider } = makeProvider(responseJson('prompt'));

    await expect(
      judgeTrace(loadGraph(toolPath), {
        provider,
        model: 'test-judge',
      }),
    ).rejects.toThrow('Unsupported judgment category');
  });

  it('rejects invalid JSON', async () => {
    const { provider } = makeProvider('Not valid JSON');

    await expect(
      judgeTrace(loadGraph(toolPath), {
        provider,
        model: 'test-judge',
      }),
    ).rejects.toThrow('LLM returned invalid JSON');
  });

  it('rejects malformed responses', async () => {
    const { provider } = makeProvider(JSON.stringify({ result: 'tool error' }));

    await expect(
      judgeTrace(loadGraph(toolPath), {
        provider,
        model: 'test-judge',
      }),
    ).rejects.toThrow('LLM response does not match the judge schema');
  });

  it('preserves unverified attribution hypotheses', async () => {
    const { provider } = makeProvider(responseJson());

    const result = await judgeTrace(loadGraph(toolPath), {
      provider,
      model: 'test-judge',
    });

    expect(result.report.hypotheses[0]?.status).toBe('unverified');
  });

  it('includes tool error details in the judge evidence', async () => {
    const { provider, requests } = makeProvider(responseJson());

    await judgeTrace(loadGraph(toolPath), {
      provider,
      model: 'test-judge',
    });

    expect(requests).toHaveLength(1);

    const userMessage = requests[0]?.messages.find((message) => message.role === 'user');

    expect(userMessage).toBeDefined();

    const evidence = JSON.parse(userMessage!.content) as {
      observations: Array<{
        ruleId: string;
        category: string;
        evidenceNodeIds: string[];
        details?: {
          toolName?: string;
          error?: string;
          latencyMs?: number;
        };
      }>;
    };

    const toolObservation = evidence.observations.find(
      (observation) => observation.ruleId === 'TOOL-02',
    );

    expect(toolObservation).toBeDefined();

    expect(toolObservation?.category).toBe('tool');

    expect(toolObservation?.evidenceNodeIds).toContain('1000000000000006');

    expect(toolObservation?.details).toMatchObject({
      toolName: 'apply_patch',
      error: 'PATCH_APPLY_FAILED: context mismatch',
      latencyMs: 1400,
    });
  });
});
