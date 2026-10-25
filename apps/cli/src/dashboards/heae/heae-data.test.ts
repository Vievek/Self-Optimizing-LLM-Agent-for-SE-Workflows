import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTraceGraph, KuzuInteractionStore, parseTraceJsonl } from '@soa/heae';
import { ReadOnlyHeaeGraphReader } from './heae-data.js';

describe('read-only HEAE graph reader', () => {
  let directory: string;
  let databasePath: string;
  let store: KuzuInteractionStore | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'heae-readonly-test-'));
    databasePath = path.join(directory, 'heae.kuzu');
  });

  afterEach(async () => {
    if (store) await store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('loads a controlled trace through the existing graph schema without changing it', async () => {
    const content = await readFile('packages/heae/fixtures/tool-error.jsonl', 'utf8');
    const expected = buildTraceGraph(parseTraceJsonl(content));
    store = await KuzuInteractionStore.open(databasePath);
    await store.saveGraph(expected);
    await store.close();
    store = undefined;

    const graph = await new ReadOnlyHeaeGraphReader(databasePath).loadGraph(expected.traceId);

    expect(graph).not.toBeNull();
    expect(graph?.traceId).toBe(expected.traceId);
    expect(graph?.nodes.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: '1000000000000001', type: 'TaskNode' },
      { id: '1000000000000002', type: 'PlanNode' },
      { id: '1000000000000003', type: 'RetrievalNode' },
      { id: '1000000000000004', type: 'RouteNode' },
      { id: '1000000000000005', type: 'PromptNode' },
      { id: '1000000000000006', type: 'ToolCallNode' },
      { id: '1000000000000007', type: 'OutputNode' },
    ]);
    expect(graph?.edges).toHaveLength(12);
    expect(graph?.edges).toEqual(expected.edges);
    expect(graph?.edges.filter((edge) => edge.type === 'PARENT_OF')).toHaveLength(6);
    expect(graph?.edges.filter((edge) => edge.type === 'CAUSED_BY')).toHaveLength(6);

    store = await KuzuInteractionStore.open(databasePath);
    expect(await store.loadGraph(expected.traceId)).toEqual(expected);
  });

  it('returns missing for a nonexistent database without creating it', async () => {
    const graph = await new ReadOnlyHeaeGraphReader(databasePath).loadGraph(
      '0123456789abcdef0123456789abcdef',
    );

    expect(graph).toBeNull();
    await expect(access(databasePath)).rejects.toThrow();
  });
});
