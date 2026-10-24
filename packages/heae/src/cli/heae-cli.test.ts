import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@soa/store';

import { runHeaeCli } from './heae-cli.js';
import type { LlmProvider } from '@soa/llm';
import { EvaluationHistory } from '../persistence/evaluation-history.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { KuzuInteractionStore } from '../persistence/kuzu-interaction-store.js';
import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';
import { readFileSync } from 'node:fs';

const toolFixture = 'packages/heae/fixtures/tool-error.jsonl';

const successFixture = 'fixtures/traces/success.jsonl';

const toolTraceId = '0123456789abcdef0123456789abcdef';

describe('HEAE standalone CLI', () => {
  it('displays help', async () => {
    const output = await runHeaeCli(['help']);

    expect(output).toContain('heae evaluate');
    expect(output).toContain('heae history');
  });

  it('evaluates a trace and saves the result', async () => {
    const store = new MemoryStore();

    const output = await runHeaeCli(['evaluate', toolFixture], { store });

    const result = JSON.parse(output) as {
      traceId: string;
      observationCount: number;
      saved: boolean;
    };

    expect(result.traceId).toBe(toolTraceId);
    expect(result.observationCount).toBe(1);
    expect(result.saved).toBe(true);

    expect(await store.exists(`heae/evaluations/${toolTraceId}.json`)).toBe(true);
  });

  it('lists previously saved evaluations', async () => {
    const store = new MemoryStore();

    await runHeaeCli(['evaluate', toolFixture], { store });

    const output = await runHeaeCli(['history'], { store });

    const records = JSON.parse(output) as Array<{
      traceId: string;
      outcome: string;
    }>;

    expect(records).toHaveLength(1);
    expect(records[0]?.traceId).toBe(toolTraceId);
    expect(records[0]?.outcome).toBe('fail');
  });

  it('retrieves a saved evaluation by trace ID', async () => {
    const store = new MemoryStore();

    await runHeaeCli(['evaluate', toolFixture], { store });

    const output = await runHeaeCli(['history', toolTraceId], { store });

    const record = JSON.parse(output) as {
      traceId: string;
      schemaVersion: string;
    };

    expect(record.traceId).toBe(toolTraceId);
    expect(record.schemaVersion).toBe('1.0');
  });

  it('reports when no evaluation is saved', async () => {
    const output = await runHeaeCli(['history'], { store: new MemoryStore() });

    expect(output).toContain('No saved HEAE evaluations');
  });

  it('rejects missing trace paths', async () => {
    await expect(runHeaeCli(['evaluate'], { store: new MemoryStore() })).rejects.toThrow(
      'Usage: heae evaluate',
    );
  });

  it('rejects unknown commands', async () => {
    await expect(runHeaeCli(['unknown'])).rejects.toThrow('Unknown HEAE command');
  });

  it('rejects malformed trace files', async () => {
    await expect(
      runHeaeCli(['evaluate', 'does-not-exist.jsonl'], { store: new MemoryStore() }),
    ).rejects.toThrow('Unable to read trace file');
  });

  it('preserves the clean trace outcome', async () => {
    const store = new MemoryStore();

    const output = await runHeaeCli(['evaluate', successFixture], { store });

    const result = JSON.parse(output) as {
      observationCount: number;
      judgeStatus: string;
      saved: boolean;
    };

    expect(result.observationCount).toBe(0);
    expect(result.judgeStatus).toBe('skipped');
    expect(result.saved).toBe(true);
  });

  it('shows the optional judge flag in help', async () => {
    const output = await runHeaeCli(['help']);

    expect(output).toContain('heae evaluate <trace.jsonl> --judge');
  });

  it('runs hybrid attribution with an injected mock judge', async () => {
    const store = new MemoryStore();

    let chatCalls = 0;

    const provider: LlmProvider = {
      async chat(request) {
        chatCalls += 1;

        return {
          content: JSON.stringify({
            findings: [
              {
                category: 'tool',
                assessment: 'insufficient_evidence',
                explanation: 'The tool failed, but its root cause is not proven.',
                evidenceNodeIds: ['1000000000000006'],
                limitations: ['There is insufficient evidence of causality.'],
              },
            ],
            overallUncertainty: 'The cause requires independent verification.',
          }),
          tokensIn: 20,
          tokensOut: 30,
          model: request.model,
          provider: 'mock',
        };
      },

      async embed() {
        return [];
      },
    };

    const output = await runHeaeCli(['evaluate', toolFixture, '--judge'], {
      store,
      provider,
      model: 'test-judge',
    });

    const summary = JSON.parse(output) as {
      judgeStatus: string;
      observationCount: number;
      saved: boolean;
    };

    expect(chatCalls).toBe(1);
    expect(summary.judgeStatus).toBe('completed');
    expect(summary.observationCount).toBe(1);
    expect(summary.saved).toBe(true);

    const saved = await new EvaluationHistory(store).load(toolTraceId);

    expect(saved?.result.judgment?.findings[0]?.category).toBe('tool');
  });

  it('rejects unsupported evaluate flags', async () => {
    await expect(
      runHeaeCli(['evaluate', toolFixture, '--unknown'], { store: new MemoryStore() }),
    ).rejects.toThrow('Usage: heae evaluate');
  });

  it('saves a graph when a Kuzu store is supplied', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'heae-cli-graph-'));

    const graphStore = await KuzuInteractionStore.open(path.join(directory, 'heae.kuzu'));

    try {
      const store = new MemoryStore();

      const output = await runHeaeCli(['evaluate', toolFixture], {
        store,
        graphStore,
      });

      const summary = JSON.parse(output) as {
        traceId: string;
        saved: boolean;
        graphSaved: boolean;
      };

      expect(summary.saved).toBe(true);
      expect(summary.graphSaved).toBe(true);

      const graph = await graphStore.loadGraph(summary.traceId);

      expect(graph).not.toBeNull();
      expect(graph?.nodes.length).toBeGreaterThan(0);

      const history = new EvaluationHistory(store);
      const report = await history.load(summary.traceId);

      expect(report).not.toBeNull();
    } finally {
      await graphStore.close();

      await rm(directory, {
        recursive: true,
        force: true,
      });
    }
  });

  it('recovers a missing report through the CLI', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'heae-cli-recovery-'));

    const graphStore = await KuzuInteractionStore.open(path.join(directory, 'heae.kuzu'));

    try {
      const store = new MemoryStore();

      // Simulate an interrupted evaluation:
      // Kuzu contains the graph, but FileStore has no report.
      const content = readFileSync(toolFixture, 'utf8');

      const graph = buildTraceGraph(parseTraceJsonl(content));

      await graphStore.saveGraph(graph);

      // Repair the missing report using the CLI.
      const output = await runHeaeCli(['evaluate', toolFixture, '--recover'], {
        store,
        graphStore,
      });

      const summary = JSON.parse(output) as {
        traceId: string;
        saved: boolean;
        graphSaved: boolean;
      };

      expect(summary.traceId).toBe(graph.traceId);
      expect(summary.saved).toBe(true);
      expect(summary.graphSaved).toBe(true);

      const history = new EvaluationHistory(store);
      const report = await history.load(graph.traceId);

      expect(report).not.toBeNull();
    } finally {
      await graphStore.close();

      await rm(directory, {
        recursive: true,
        force: true,
      });
    }
  });
});
