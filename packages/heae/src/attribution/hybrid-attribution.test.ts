
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ChatRequest, ChatResponse, LlmProvider } from '@soa/llm';

import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';
import { evaluateHybridAttribution } from './hybrid-attribution.js';

function loadGraph(path: URL) {
  return buildTraceGraph(
    parseTraceJsonl(readFileSync(path, 'utf8')),
  );
}

const toolPath = new URL(
  '../../fixtures/tool-error.jsonl',
  import.meta.url,
);

const successPath = new URL(
  '../../../../fixtures/traces/success.jsonl',
  import.meta.url,
);

function makeProvider(
  content: string,
  shouldFail = false,
): {
  provider: LlmProvider;
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];

  const provider: LlmProvider = {
    async chat(req): Promise<ChatResponse> {
      requests.push(req);

      if (shouldFail) {
        throw new Error('Provider temporarily unavailable');
      }

      return {
        content,
        tokensIn: 10,
        tokensOut: 10,
        model: req.model,
        provider: 'mock',
      };
    },

    async embed(): Promise<number[][]> {
      return [];
    },
  };

  return { provider, requests };
}

function validResponse(): string {
  return JSON.stringify({
    findings: [
      {
        category: 'tool',
        assessment: 'insufficient_evidence',
        explanation: 'A tool error occurred, but root causality is unclear.',
        evidenceNodeIds: ['1000000000000006'],
        limitations: ['Other related operations were not observed.'],
      },
    ],
    overallUncertainty:
      'The available evidence cannot establish definitive causality.',
  });
}

describe('HEAE hybrid attribution coordinator', () => {
  it('combines deterministic findings and model judgment', async () => {
    const { provider, requests } = makeProvider(validResponse());

    const result = await evaluateHybridAttribution(loadGraph(toolPath), {
      provider,
      model: 'test-judge',
    });

    expect(result.judgeStatus).toBe('completed');
    expect(result.judgment?.findings[0]?.category).toBe('tool');
    expect(result.ruleReport.hypotheses.length).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
  });

  it('skips model assessment for clean traces', async () => {
    const { provider, requests } = makeProvider(validResponse());

    const result = await evaluateHybridAttribution(loadGraph(successPath), {
      provider,
      model: 'test-judge',
    });

    expect(result.judgeStatus).toBe('skipped');
    expect(result.judgment).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('preserves rules when provider is missing', async () => {
    const result = await evaluateHybridAttribution(loadGraph(toolPath));

    expect(result.judgeStatus).toBe('unavailable');
    expect(result.ruleReport.hypotheses.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('not configured')))
      .toBe(true);
  });

  it('preserves rules when provider throws', async () => {
    const { provider } = makeProvider(validResponse(), true);

    const result = await evaluateHybridAttribution(loadGraph(toolPath), {
      provider,
      model: 'test-judge',
    });

    expect(result.judgeStatus).toBe('unavailable');
    expect(result.judgment).toBeNull();
    expect(result.ruleReport.hypotheses.length).toBeGreaterThan(0);
  });

  it('preserves rules when model returns invalid JSON', async () => {
    const { provider } = makeProvider('Not JSON');

    const result = await evaluateHybridAttribution(loadGraph(toolPath), {
      provider,
      model: 'test-judge',
    });

    expect(result.judgeStatus).toBe('unavailable');
    expect(result.judgment).toBeNull();
    expect(result.ruleReport.observations.length).toBeGreaterThan(0);
  });

  it('does not upgrade model assessments into proven root causes', async () => {
    const { provider } = makeProvider(validResponse());

    const result = await evaluateHybridAttribution(loadGraph(toolPath), {
      provider,
      model: 'test-judge',
    });

    expect(result.ruleReport.hypotheses[0]?.status).toBe('unverified');
    expect(result.judgment?.findings[0]?.assessment)
      .toBe('insufficient_evidence');
  });
});
