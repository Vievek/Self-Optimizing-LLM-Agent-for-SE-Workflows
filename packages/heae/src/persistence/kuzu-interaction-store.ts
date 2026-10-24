import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Connection, Database, type KuzuValue, type QueryResult } from 'kuzu';

import { TypedTraceSpanSchema } from '@soa/contracts';

import type { TraceGraph, TraceGraphEdge, TraceGraphNode } from '../trace-graph.js';

import type { EvidenceRelationship, InteractionGraphStore } from './interaction-graph-store.js';

type Params = Record<string, KuzuValue>;
type Row = Record<string, KuzuValue>;

function rowsFrom(result: QueryResult | QueryResult[]): Promise<Row[]> {
  return (async () => {
    const results = Array.isArray(result) ? result : [result];

    try {
      const rows: Row[] = [];

      for (const item of results) {
        rows.push(...(await item.getAll()));
      }

      return rows;
    } finally {
      for (const item of results) {
        item.close();
      }
    }
  })();
}

function spanKey(traceId: string, spanId: string): string {
  return JSON.stringify([traceId, spanId]);
}

function requiredString(value: KuzuValue | undefined, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid Kuzu value for ${field}`);
  }

  return value;
}

function requiredNumber(value: KuzuValue | undefined, field: string): number {
  if (typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error(`Invalid Kuzu value for ${field}`);
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number)) {
    throw new Error(`Invalid Kuzu integer for ${field}`);
  }

  return number;
}

export class KuzuInteractionStore implements InteractionGraphStore {
  private closed = false;

  private constructor(
    private readonly database: Database,
    private readonly connection: Connection,
  ) {}

  static async open(databasePath = 'store/graphs/heae.kuzu'): Promise<KuzuInteractionStore> {
    await mkdir(path.dirname(databasePath), { recursive: true });

    const database = new Database(databasePath);
    const connection = new Connection(database);

    try {
      await database.init();
      await connection.init();

      const store = new KuzuInteractionStore(database, connection);

      await store.initializeSchema();

      return store;
    } catch (error) {
      await connection.close().catch(() => undefined);
      await database.close().catch(() => undefined);
      throw error;
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('Kuzu interaction store is closed');
    }
  }

  private async query(statement: string): Promise<Row[]> {
    this.ensureOpen();
    return rowsFrom(await this.connection.query(statement));
  }

  private async execute(statement: string, params: Params): Promise<Row[]> {
    this.ensureOpen();

    const prepared = await this.connection.prepare(statement);

    if (!prepared.isSuccess()) {
      throw new Error(`Kuzu prepare failed: ${prepared.getErrorMessage()}`);
    }

    return rowsFrom(await this.connection.execute(prepared, params));
  }

  private async initializeSchema(): Promise<void> {
    const statements = [
      `CREATE NODE TABLE IF NOT EXISTS HeaeTrace(
        traceId STRING PRIMARY KEY,
        warningsJson STRING
      )`,

      `CREATE NODE TABLE IF NOT EXISTS HeaeSpan(
        key STRING PRIMARY KEY,
        traceId STRING,
        spanId STRING,
        nodeType STRING,
        spanJson STRING,
        position INT64
      )`,

      `CREATE REL TABLE IF NOT EXISTS HeaeTraceSpan(
        FROM HeaeTrace TO HeaeSpan
      )`,

      `CREATE REL TABLE IF NOT EXISTS HeaeParentOf(
        FROM HeaeSpan TO HeaeSpan,
        edgeOrder INT64
      )`,

      `CREATE REL TABLE IF NOT EXISTS HeaeCausedBy(
        FROM HeaeSpan TO HeaeSpan,
        edgeOrder INT64
      )`,
    ];

    for (const statement of statements) {
      await this.query(statement);
    }
  }

  private validateGraph(graph: TraceGraph): void {
    if (!graph.traceId || graph.nodes.length === 0) {
      throw new Error('Cannot persist an empty trace graph');
    }

    const ids = new Set<string>();

    for (const node of graph.nodes) {
      const parsed = TypedTraceSpanSchema.parse(node.span);

      if (parsed.trace_id !== graph.traceId || parsed.span_id !== node.id || ids.has(node.id)) {
        throw new Error(`Invalid or duplicate graph node: ${node.id}`);
      }

      ids.add(node.id);
    }

    for (const edge of graph.edges) {
      if (
        !ids.has(edge.source) ||
        !ids.has(edge.target) ||
        (edge.type !== 'PARENT_OF' && edge.type !== 'CAUSED_BY')
      ) {
        throw new Error('Graph contains an invalid relationship');
      }
    }
  }

  async saveGraph(graph: TraceGraph): Promise<void> {
    this.ensureOpen();
    this.validateGraph(graph);

    if (await this.loadGraph(graph.traceId)) {
      throw new Error(`Trace already exists: ${graph.traceId}`);
    }

    await this.query('BEGIN TRANSACTION');

    try {
      await this.execute(
        `CREATE (:HeaeTrace {
          traceId: $traceId,
          warningsJson: $warningsJson
        })`,
        {
          traceId: graph.traceId,
          warningsJson: JSON.stringify(graph.warnings),
        },
      );

      for (const [position, node] of graph.nodes.entries()) {
        const key = spanKey(graph.traceId, node.id);

        await this.execute(
          `CREATE (:HeaeSpan {
            key: $key,
            traceId: $traceId,
            spanId: $spanId,
            nodeType: $nodeType,
            spanJson: $spanJson,
            position: $position
          })`,
          {
            key,
            traceId: graph.traceId,
            spanId: node.id,
            nodeType: node.type,
            spanJson: JSON.stringify(node.span),
            position,
          },
        );

        await this.execute(
          `MATCH (t:HeaeTrace), (s:HeaeSpan)
           WHERE t.traceId = $traceId
             AND s.key = $key
           CREATE (t)-[:HeaeTraceSpan]->(s)`,
          {
            traceId: graph.traceId,
            key,
          },
        );
      }

      for (const [position, edge] of graph.edges.entries()) {
        const relation = edge.type === 'PARENT_OF' ? 'HeaeParentOf' : 'HeaeCausedBy';

        // Relation name is selected from two
        // fixed constants, never user input.
        await this.execute(
          `MATCH (a:HeaeSpan), (b:HeaeSpan)
           WHERE a.key = $sourceKey
             AND b.key = $targetKey
           CREATE (a)-[:${relation} {
             edgeOrder: $position
           }]->(b)`,
          {
            sourceKey: spanKey(graph.traceId, edge.source),
            targetKey: spanKey(graph.traceId, edge.target),
            position,
          },
        );
      }

      await this.query('COMMIT');
    } catch (error) {
      try {
        await this.query('ROLLBACK');
      } catch {
        // Preserve the original failure.
      }

      throw error;
    }
  }

  private async storedEdges(traceId: string): Promise<
    Array<{
      position: number;
      edge: TraceGraphEdge;
    }>
  > {
    const relations = [
      {
        table: 'HeaeParentOf',
        type: 'PARENT_OF' as const,
      },
      {
        table: 'HeaeCausedBy',
        type: 'CAUSED_BY' as const,
      },
    ];

    const edges: Array<{
      position: number;
      edge: TraceGraphEdge;
    }> = [];

    for (const relation of relations) {
      const rows = await this.execute(
        `MATCH (a:HeaeSpan)-[r:${relation.table}]
          ->(b:HeaeSpan)
         WHERE a.traceId = $traceId
           AND b.traceId = $traceId
         RETURN
           a.spanId AS source,
           b.spanId AS target,
           r.edgeOrder AS position`,
        { traceId },
      );

      for (const row of rows) {
        edges.push({
          position: requiredNumber(row.position, 'edge position'),
          edge: {
            source: requiredString(row.source, 'source'),
            target: requiredString(row.target, 'target'),
            type: relation.type,
          },
        });
      }
    }

    return edges.sort((a, b) => a.position - b.position);
  }

  async listEdges(traceId: string): Promise<TraceGraphEdge[]> {
    const edges = await this.storedEdges(traceId);
    return edges.map((entry) => entry.edge);
  }

  async loadGraph(traceId: string): Promise<TraceGraph | null> {
    const traces = await this.execute(
      `MATCH (t:HeaeTrace)
       WHERE t.traceId = $traceId
       RETURN t.warningsJson AS warningsJson`,
      { traceId },
    );

    if (traces.length === 0) {
      return null;
    }

    const warnings = JSON.parse(
      requiredString(traces[0]!.warningsJson, 'warningsJson'),
    ) as string[];

    const rows = await this.execute(
      `MATCH (s:HeaeSpan)
       WHERE s.traceId = $traceId
       RETURN
         s.spanId AS spanId,
         s.nodeType AS nodeType,
         s.spanJson AS spanJson,
         s.position AS position`,
      { traceId },
    );

    const nodes: TraceGraphNode[] = rows
      .sort(
        (a, b) => requiredNumber(a.position, 'position') - requiredNumber(b.position, 'position'),
      )
      .map((row) => {
        const span = TypedTraceSpanSchema.parse(
          JSON.parse(requiredString(row.spanJson, 'spanJson')),
        );

        return {
          id: requiredString(row.spanId, 'spanId'),
          type: requiredString(row.nodeType, 'nodeType') as TraceGraphNode['type'],
          span,
        };
      });

    return {
      traceId,
      nodes,
      edges: await this.listEdges(traceId),
      warnings,
    };
  }

  async getEvidenceRelationships(traceId: string, spanId: string): Promise<EvidenceRelationship[]> {
    const graph = await this.loadGraph(traceId);

    if (!graph) {
      return [];
    }

    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));

    const results: EvidenceRelationship[] = [];

    for (const edge of graph.edges) {
      if (edge.source !== spanId && edge.target !== spanId) {
        continue;
      }

      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);

      if (source && target) {
        results.push({
          source,
          target,
          type: edge.type,
        });
      }
    }

    return results;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    try {
      await this.connection.close();
    } finally {
      await this.database.close();
    }
  }
}
