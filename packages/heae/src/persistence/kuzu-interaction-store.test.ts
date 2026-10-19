
import { mkdtemp, readFile } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { parseTraceJsonl } from '../trace-intake.js';
import {
  buildTraceGraph,
  type TraceGraph,
} from '../trace-graph.js';

import { KuzuInteractionStore } from './kuzu-interaction-store.js';

const fixturePath =
  'packages/heae/fixtures/tool-error.jsonl';

describe('HEAE Kuzu interaction graph', () => {
  let directory: string;
  let databasePath: string;
  let store: KuzuInteractionStore;

  async function fixtureGraph(): Promise<TraceGraph> {
    const content = await readFile(
      fixturePath,
      'utf8',
    );

    return buildTraceGraph(
      parseTraceJsonl(content),
    );
  }

  beforeEach(async () => {
    directory = await mkdtemp(
      path.join(tmpdir(), 'heae-kuzu-test-'),
    );

    databasePath = path.join(
      directory,
      'heae.kuzu',
    );

    store = await KuzuInteractionStore.open(
      databasePath,
    );
  });

  afterEach(async () => {
    await store.close();

    await rm(directory, {
      recursive: true,
      force: true,
    });
  });

  it('saves and loads the original trace graph', async () => {
    const graph = await fixtureGraph();

    await store.saveGraph(graph);

    const loaded = await store.loadGraph(
      graph.traceId,
    );

    expect(loaded).toEqual(graph);
  });

  it('preserves tool failure metadata', async () => {
    const graph = await fixtureGraph();

    await store.saveGraph(graph);

    const loaded = await store.loadGraph(
      graph.traceId,
    );

    const toolNode = loaded?.nodes.find(
      (node) => node.type === 'ToolCallNode',
    );

    expect(toolNode?.span.name).toBe('tool_call');

    if (toolNode?.span.name === 'tool_call') {
      expect(
        toolNode.span.attributes.tool_name,
      ).toBe('apply_patch');
    }
  });

  it('preserves both relationship types', async () => {
    const graph = await fixtureGraph();

    await store.saveGraph(graph);

    const edges = await store.listEdges(
      graph.traceId,
    );

    expect(edges).toEqual(graph.edges);
  });

  it('retrieves relationships for evidence nodes', async () => {
    const graph = await fixtureGraph();

    await store.saveGraph(graph);

    const evidenceNode =
      graph.nodes.find(
        (node) => node.type === 'ToolCallNode',
      );

    expect(evidenceNode).toBeDefined();

    const relations =
      await store.getEvidenceRelationships(
        graph.traceId,
        evidenceNode!.id,
      );

    const expected = graph.edges.filter(
      (edge) =>
        edge.source === evidenceNode!.id ||
        edge.target === evidenceNode!.id,
    );

    expect(relations).toHaveLength(
      expected.length,
    );

    expect(
      relations.every(
        (relation) =>
          relation.source.id === evidenceNode!.id ||
          relation.target.id === evidenceNode!.id,
      ),
    ).toBe(true);
  });

  it('rejects duplicate traces', async () => {
    const graph = await fixtureGraph();

    await store.saveGraph(graph);

    await expect(
      store.saveGraph(graph),
    ).rejects.toThrow(
      'Trace already exists',
    );
  });

  it('returns null for missing traces', async () => {
    const graph = await fixtureGraph();

    expect(
      await store.loadGraph(graph.traceId),
    ).toBeNull();
  });

  it('isolates separate trace IDs', async () => {
    const graphA = await fixtureGraph();

    const traceIdB =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    const graphB = buildTraceGraph(
      graphA.nodes.map((node) => ({
        ...structuredClone(node.span),
        trace_id: traceIdB,
      })),
    );

    await store.saveGraph(graphA);
    await store.saveGraph(graphB);

    expect(
      await store.loadGraph(graphA.traceId),
    ).toEqual(graphA);

    expect(
      await store.loadGraph(graphB.traceId),
    ).toEqual(graphB);
  });

  it('rejects invalid edges without saving', async () => {
    const graph = await fixtureGraph();

    graph.edges.push({
      source: graph.nodes[0]!.id,
      target: 'missing-span',
      type: 'PARENT_OF',
    });

    await expect(
      store.saveGraph(graph),
    ).rejects.toThrow(
      'Graph contains an invalid relationship',
    );

    expect(
      await store.loadGraph(graph.traceId),
    ).toBeNull();
  });

  it('persists graph data across reopening', async () => {
    const graph = await fixtureGraph();

    await store.saveGraph(graph);
    await store.close();

    store = await KuzuInteractionStore.open(
      databasePath,
    );

    expect(
      await store.loadGraph(graph.traceId),
    ).toEqual(graph);
  });
});
