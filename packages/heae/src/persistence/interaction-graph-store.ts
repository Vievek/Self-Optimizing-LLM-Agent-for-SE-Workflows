import type { GraphEdgeType, TraceGraph, TraceGraphEdge, TraceGraphNode } from '../trace-graph.js';

export interface EvidenceRelationship {
  source: TraceGraphNode;
  target: TraceGraphNode;
  type: GraphEdgeType;
}

export interface InteractionGraphStore {
  /**
   * Persist a validated trace graph.
   *
   * An existing trace ID must not be overwritten.
   */
  saveGraph(graph: TraceGraph): Promise<void>;

  /**
   * Retrieve the original graph structure.
   *
   * Returns null if the trace does not exist.
   */
  loadGraph(traceId: string): Promise<TraceGraph | null>;

  /**
   * Retrieve edges connected to a specific span.
   *
   * Both incoming and outgoing edges are included.
   */
  getEvidenceRelationships(traceId: string, spanId: string): Promise<EvidenceRelationship[]>;

  /**
   * Retrieve edges for a whole trace.
   */
  listEdges(traceId: string): Promise<TraceGraphEdge[]>;

  /**
   * Release database resources.
   */
  close(): Promise<void>;
}
