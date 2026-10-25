import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { FileStore } from '@soa/store';

import { evaluateTrace } from './evaluate-trace.js';
import { EvaluationHistory } from '../persistence/evaluation-history.js';
import { KuzuInteractionStore } from '../persistence/kuzu-interaction-store.js';

const content = readFileSync('packages/heae/fixtures/tool-error.jsonl', 'utf8');

describe('HEAE dual persistence workflow', () => {
  it('saves graph and attribution report', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'heae-workflow-'));

    const graphStore = await KuzuInteractionStore.open(path.join(directory, 'interaction.kuzu'));

    try {
      const store = new FileStore(path.join(directory, 'reports'));

      const result = await evaluateTrace(content, {
        store,
        graphStore,
      });

      expect(result.summary.saved).toBe(true);
      expect(result.summary.graphSaved).toBe(true);

      const savedGraph = await graphStore.loadGraph(result.summary.traceId);

      expect(savedGraph).not.toBeNull();
      expect(savedGraph?.nodes.length).toBeGreaterThan(0);

      const savedReport = await new EvaluationHistory(store).load(result.summary.traceId);

      expect(savedReport?.result.traceId).toBe(result.summary.traceId);
    } finally {
      await graphStore.close();
      await rm(directory, {
        recursive: true,
        force: true,
      });
    }
  });

  it('rejects duplicate evaluations before rewriting the graph', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'heae-duplicate-'));

    const graphStore = await KuzuInteractionStore.open(path.join(directory, 'interaction.kuzu'));

    try {
      const store = new FileStore(path.join(directory, 'reports'));

      await evaluateTrace(content, {
        store,
        graphStore,
      });

      await expect(
        evaluateTrace(content, {
          store,
          graphStore,
        }),
      ).rejects.toThrow('already exists');
    } finally {
      await graphStore.close();
      await rm(directory, {
        recursive: true,
        force: true,
      });
    }
  });

  it('reports partial persistence when report saving fails', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'heae-partial-'));

    const graphStore = await KuzuInteractionStore.open(path.join(directory, 'interaction.kuzu'));

    try {
      const store = new FileStore(path.join(directory, 'reports'));

      // Simulate a report write failure after the graph
      // has been saved to Kuzu.
      const originalWrite = store.write.bind(store);
      store.write = async (..._args) => {
        throw new Error('Simulated report write failure');
      };

      try {
        await expect(
          evaluateTrace(content, {
            store,
            graphStore,
          }),
        ).rejects.toMatchObject({
          name: 'EvaluationPersistenceError',
          graphSaved: true,
          reportSaved: false,
        });
      } finally {
        store.write = originalWrite;
      }
    } finally {
      await graphStore.close();
      await rm(directory, {
        recursive: true,
        force: true,
      });
    }
  });
});
