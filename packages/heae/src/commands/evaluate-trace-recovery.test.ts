
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

/**
 * Synthetic tool-error fixture for recovery testing.
 */
const content = readFileSync(
  new URL('../../fixtures/tool-error.jsonl', import.meta.url),
  'utf8',
);

/**
 * Create isolated temporary persistence stores.
 *
 * MemoryStore holds evaluation reports.
 * Kuzu stores the interaction graph on disk.
 *
 * Each test receives a fresh database.
 */
async function withStores(
  run: (
    store: MemoryStore,
    graphStore: KuzuInteractionStore,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'heae-recovery-'),
  );

  let graphStore: KuzuInteractionStore | undefined;

  try {
    graphStore = await KuzuInteractionStore.open(
      path.join(directory, 'interaction.kuzu'),
    );

    await run(new MemoryStore(), graphStore);
  } finally {
    if (graphStore) {
      await graphStore.close();
    }

    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
}

describe('HEAE persistence recovery', () => {
  /**
   * Scenario 1:
   * Kuzu graph exists but evaluation report is missing.
   */
  it('recovers a missing report from a saved graph', async () => {
    await withStores(async (store, graphStore) => {
      const graph = buildTraceGraph(
        parseTraceJsonl(content),
      );

      // Simulate a previous successful graph save.
      await graphStore.saveGraph(graph);

      // Recover the missing evaluation report.
      const result = await evaluateTrace(content, {
        store,
        graphStore,
        recovery: true,
      });

      expect(result.summary.graphSaved).toBe(true);
      expect(result.summary.saved).toBe(true);

      const history = new EvaluationHistory(store);

      const savedReport = await history.load(
        graph.traceId,
      );

      expect(savedReport).not.toBeNull();

      expect(savedReport?.traceFingerprint).toMatch(
        /^[0-9a-f]{64}$/,
      );
    });
  });

  /**
   * Scenario 2:
   * Evaluation report exists but Kuzu graph is missing.
   *
   * The existing report must not be overwritten.
   */
  it('recovers a missing graph without replacing the report', async () => {
    await withStores(async (store, graphStore) => {
      // Save only the evaluation report.
      const original = await evaluateTrace(content, {
        store,
      });

      const history = new EvaluationHistory(store);

      const before = await history.load(
        original.summary.traceId,
      );

      expect(before).not.toBeNull();

      // Recover the missing Kuzu graph.
      const recovered = await evaluateTrace(content, {
        store,
        graphStore,
        recovery: true,
      });

      const after = await history.load(
        original.summary.traceId,
      );

      expect(recovered.summary.saved).toBe(true);
      expect(recovered.summary.graphSaved).toBe(true);

      // The original attribution must be preserved.
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

  /**
   * Scenario 3:
   * A stored graph does not match the incoming trace.
   *
   * Recovery must be rejected before writing a report.
   */
  it('rejects a mismatched saved graph', async () => {
    await withStores(async (store, graphStore) => {
      const graph = buildTraceGraph(
        parseTraceJsonl(content),
      );

      // Deliberately change the saved graph.
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

      // Rejected recovery must not create a report.
      const report = await new EvaluationHistory(
        store,
      ).load(graph.traceId);

      expect(report).toBeNull();
    });
  });

  /**
   * Scenario 4:
   * A saved evaluation contains a SHA-256 fingerprint.
   *
   * If the incoming trace metadata changes,
   * recovery must reject the modified trace.
   */
  it('rejects recovery when a trace fingerprint differs', async () => {
    await withStores(async (store, graphStore) => {
      // STEP 1: Evaluate and save the original trace.
      const original = await evaluateTrace(content, {
        store,
      });

      const history = new EvaluationHistory(store);

      // STEP 2: Verify the saved fingerprint.
      const savedRecord = await history.load(
        original.summary.traceId,
      );

      expect(savedRecord).not.toBeNull();

      expect(savedRecord?.traceFingerprint).toMatch(
        /^[0-9a-f]{64}$/,
      );

      // STEP 3: Modify the timestamp of one span.
      // Keep the same trace ID so recovery finds
      // the existing report.
      const modifiedContent = content
        .trim()
        .split('\n')
        .map((line, index) => {
          const span = JSON.parse(line) as {
            start_ts: string;
            [key: string]: unknown;
          };

          if (index === 0) {
            span.start_ts = new Date(
              new Date(span.start_ts).getTime() - 1000,
            ).toISOString();
          }

          return JSON.stringify(span);
        })
        .join('\n');

      // STEP 4: Recovery must reject the modified trace.
      await expect(
        evaluateTrace(modifiedContent, {
          store,
          graphStore,
          recovery: true,
        }),
      ).rejects.toThrow(
        'stored trace fingerprint differs',
      );

      // STEP 5: No graph should be written.
      const graph = await graphStore.loadGraph(
        original.summary.traceId,
      );

      expect(graph).toBeNull();

      // STEP 6: The original report must remain intact.
      const after = await history.load(
        original.summary.traceId,
      );

      expect(after).toEqual(savedRecord);
    });
  });

  /**
   * Scenario 5:
   * Older evaluation reports have no fingerprint.
   *
   * Recovery must remain compatible with those records,
   * using the existing rule-report consistency check.
   */
  it('supports recovery of legacy reports without fingerprints', async () => {
    await withStores(async (store, graphStore) => {
      // Produce an attribution without persistence.
      const original = await evaluateTrace(content);

      const history = new EvaluationHistory(store);

      // Simulate a legacy report by saving the
      // attribution without a trace fingerprint.
      await history.save(original.attribution);

      const legacyBefore = await history.load(
        original.summary.traceId,
      );

      expect(legacyBefore?.traceFingerprint).toBeUndefined();

      // Recover the missing graph.
      const recovered = await evaluateTrace(content, {
        store,
        graphStore,
        recovery: true,
      });

      expect(recovered.summary.saved).toBe(true);
      expect(recovered.summary.graphSaved).toBe(true);

      // Recovery must preserve the original report.
      const legacyAfter = await history.load(
        original.summary.traceId,
      );

      expect(legacyAfter).toEqual(legacyBefore);

      expect(
        legacyAfter?.traceFingerprint,
      ).toBeUndefined();

      const graph = await graphStore.loadGraph(
        original.summary.traceId,
      );

      expect(graph).not.toBeNull();
    });
  });
});
