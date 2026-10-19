
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@soa/store';

import { evaluateTrace } from './evaluate-trace.js';
import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';
import { EvaluationHistory } from '../persistence/evaluation-history.js';
import { KuzuInteractionStore } from '../persistence/kuzu-interaction-store.js';

const content = readFileSync(
  new URL('../../fixtures/tool-error.jsonl', import.meta.url),
  'utf8',
);

async function withStores(
  run: (
    store: MemoryStore,
    graphStore: KuzuInteractionStore,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'heae-recovery-'),
  );

  const graphStore = await KuzuInteractionStore.open(
    path.join(directory, 'interaction.kuzu'),
  );

  try {
    await run(new MemoryStore(), graphStore);
  } finally {
    await graphStore.close();
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
}

describe('HEAE persistence recovery', () => {
  it('recovers a missing report from a saved graph', async () => {
    await withStores(async (store, graphStore) => {
      const graph = buildTraceGraph(
        parseTraceJsonl(content),
      );

      await graphStore.saveGraph(graph);

      const result = await evaluateTrace(content, {
        store,
        graphStore,
        recovery: true,
      });

      expect(result.summary.graphSaved).toBe(true);
      expect(result.summary.saved).toBe(true);

      const savedReport = await new EvaluationHistory(
        store,
      ).load(graph.traceId);

      expect(savedReport).not.toBeNull();
    });
  });

  it('recovers a missing graph without replacing the report', async () => {
    await withStores(async (store, graphStore) => {
      const original = await evaluateTrace(
        content,
        { store },
      );

      const before = await new EvaluationHistory(
        store,
      ).load(original.summary.traceId);

      const recovered = await evaluateTrace(content, {
        store,
        graphStore,
        recovery: true,
      });

      const after = await new EvaluationHistory(
        store,
      ).load(original.summary.traceId);

      expect(recovered.summary.saved).toBe(true);
      expect(recovered.summary.graphSaved).toBe(true);
      expect(recovered.attribution).toEqual(
        original.attribution,
      );
      expect(after).toEqual(before);

      const graph = await graphStore.loadGraph(
        original.summary.traceId,
      );

      expect(graph).not.toBeNull();
    });
  });

  it('rejects a mismatched saved graph', async () => {
    await withStores(async (store, graphStore) => {
      const graph = buildTraceGraph(
        parseTraceJsonl(content),
      );

      // Produce a different graph with the same trace ID.
      graph.warnings.push(
        'Injected inconsistency for recovery test',
      );

      await graphStore.saveGraph(graph);

      await expect(
        evaluateTrace(content, {
          store,
          graphStore,
          recovery: true,
        }),
      ).rejects.toThrow(
        'stored graph differs',
      );

      const report = await new EvaluationHistory(
        store,
      ).load(graph.traceId);

      expect(report).toBeNull();
    });
  });
});
