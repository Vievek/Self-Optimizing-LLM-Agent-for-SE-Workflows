import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EvaluationHistory,
  OPTIMIZATION_EVENT_PATH,
  type StoredEvaluation,
  type TraceGraph,
  type TraceGraphNode,
} from '@soa/heae';
import {
  OptimizationSignalSchema,
  TypedTraceSpanSchema,
  type OptimizationSignal,
} from '@soa/contracts';
import { FileStore, type Store } from '@soa/store';
import { Connection, Database, type KuzuValue, type QueryResult } from 'kuzu';

type Row = Record<string, KuzuValue>;

export interface HeaeDataReader {
  list(): Promise<StoredEvaluation[]>;
  loadGraph?(traceId: string): Promise<TraceGraph | null>;
  listSignals?(traceId: string): Promise<OptimizationSignal[]>;
}

// Resolve the project root using this module's location.
// Works from both src/ and dist/ layouts.
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, '../../../../..');

export const HEAE_HISTORY_DIRECTORY = path.join(repositoryRoot, '.heae', 'history');

export const HEAE_GRAPH_DATABASE = path.join(repositoryRoot, 'store', 'graphs', 'heae.kuzu');

function rowsFrom(result: QueryResult | QueryResult[]): Promise<Row[]> {
  return (async () => {
    const results = Array.isArray(result) ? result : [result];
    try {
      const rows: Row[] = [];
      for (const item of results) rows.push(...(await item.getAll()));
      return rows;
    } finally {
      for (const item of results) item.close();
    }
  })();
}

function requiredString(value: KuzuValue | undefined, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Kuzu value for ${field}`);
  return value;
}

function requiredNumber(value: KuzuValue | undefined, field: string): number {
  if (typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error(`Invalid Kuzu value for ${field}`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`Invalid Kuzu integer for ${field}`);
  return number;
}

/**
 * Reads the existing HEAE graph database without invoking KuzuInteractionStore.open().
 * That public writer-oriented factory creates directories and initializes schema tables.
 */
export class ReadOnlyHeaeGraphReader {
  constructor(private readonly databasePath = HEAE_GRAPH_DATABASE) {}

  async loadGraph(traceId: string): Promise<TraceGraph | null> {
    try {
      await access(this.databasePath);
    } catch {
      return null;
    }

    const database = new Database(this.databasePath, 0, true, true);
    const connection = new Connection(database);

    try {
      await database.init();
      await connection.init();

      const execute = async (statement: string): Promise<Row[]> => {
        const prepared = await connection.prepare(statement);
        if (!prepared.isSuccess())
          throw new Error(`Kuzu prepare failed: ${prepared.getErrorMessage()}`);
        return rowsFrom(await connection.execute(prepared, { traceId }));
      };

      const traces = await execute(`
        MATCH (t:HeaeTrace)
        WHERE t.traceId = $traceId
        RETURN t.warningsJson AS warningsJson
      `);
      if (traces.length === 0) return null;

      const nodes = (
        await execute(`
        MATCH (s:HeaeSpan)
        WHERE s.traceId = $traceId
        RETURN s.spanId AS spanId, s.nodeType AS nodeType,
               s.spanJson AS spanJson, s.position AS position
      `)
      )
        .sort(
          (left, right) =>
            requiredNumber(left.position, 'position') - requiredNumber(right.position, 'position'),
        )
        .map((row) => ({
          id: requiredString(row.spanId, 'spanId'),
          type: requiredString(row.nodeType, 'nodeType') as TraceGraphNode['type'],
          span: TypedTraceSpanSchema.parse(JSON.parse(requiredString(row.spanJson, 'spanJson'))),
        }));

      const edges: Array<TraceGraph['edges'][number] & { position: number }> = [];
      for (const relation of [
        ['HeaeParentOf', 'PARENT_OF'] as const,
        ['HeaeCausedBy', 'CAUSED_BY'] as const,
      ]) {
        const rows = await execute(`
          MATCH (a:HeaeSpan)-[r:${relation[0]}]->(b:HeaeSpan)
          WHERE a.traceId = $traceId AND b.traceId = $traceId
          RETURN a.spanId AS source, b.spanId AS target, r.edgeOrder AS position
        `);
        edges.push(
          ...rows.map((row) => ({
            source: requiredString(row.source, 'source'),
            target: requiredString(row.target, 'target'),
            type: relation[1],
            position: requiredNumber(row.position, 'edge position'),
          })),
        );
      }

      edges.sort((left, right) => left.position - right.position);
      return {
        traceId,
        nodes,
        edges: edges.map(({ position: _position, ...edge }) => edge),
        warnings: JSON.parse(requiredString(traces[0]!.warningsJson, 'warningsJson')) as string[],
      };
    } finally {
      await connection.close();
      await database.close();
    }
  }
}

/** Read-only access to persisted HEAE evaluations for the TUI. */
export class HeaeDataSource implements HeaeDataReader {
  private readonly history: EvaluationHistory;
  private readonly graphs: ReadOnlyHeaeGraphReader;
  private readonly store: Store;

  constructor(
    store: Store = new FileStore(HEAE_HISTORY_DIRECTORY),
    graphs = new ReadOnlyHeaeGraphReader(),
  ) {
    this.history = new EvaluationHistory(store);
    this.graphs = graphs;
    this.store = store;
  }

  async list(): Promise<StoredEvaluation[]> {
    const evaluations = await this.history.list();

    return evaluations.sort((left, right) => left.traceId.localeCompare(right.traceId));
  }

  loadGraph(traceId: string): Promise<TraceGraph | null> {
    return this.graphs.loadGraph(traceId);
  }

  async listSignals(traceId: string): Promise<OptimizationSignal[]> {
    const records = OptimizationSignalSchema.array().parse(
      await this.store.readJsonl<unknown>(OPTIMIZATION_EVENT_PATH),
    );
    return records.filter((record) => record.trace_id === traceId);
  }
}
