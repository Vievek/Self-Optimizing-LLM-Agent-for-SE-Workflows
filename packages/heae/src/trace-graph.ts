import { TypedTraceSpanSchema, type TypedTraceSpan } from '@soa/contracts';

export type GraphNodeType =
  | 'TaskNode'
  | 'PromptNode'
  | 'PlanNode'
  | 'ToolCallNode'
  | 'RetrievalNode'
  | 'RouteNode'
  | 'OutputNode';

export type GraphEdgeType = 'PARENT_OF' | 'CAUSED_BY';

export interface TraceGraphNode {
  id: string;
  type: GraphNodeType;
  span: TypedTraceSpan;
}

export interface TraceGraphEdge {
  source: string;
  target: string;
  type: GraphEdgeType;
}

export interface TraceGraph {
  traceId: string;
  nodes: TraceGraphNode[];
  edges: TraceGraphEdge[];
  warnings: string[];
}

export class TraceGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TraceGraphError';
  }
}

const NODE_TYPES: Record<TypedTraceSpan['name'], GraphNodeType> = {
  task: 'TaskNode',
  prompt: 'PromptNode',
  plan: 'PlanNode',
  tool_call: 'ToolCallNode',
  retrieval: 'RetrievalNode',
  route: 'RouteNode',
  output: 'OutputNode',
};

function validateParentCycles(spans: Map<string, TypedTraceSpan>): void {
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(spanId: string): void {
    if (visiting.has(spanId)) {
      throw new TraceGraphError(`Parent cycle detected at span ${spanId}`);
    }

    if (visited.has(spanId)) {
      return;
    }

    visiting.add(spanId);

    const span = spans.get(spanId);
    const parentId = span?.parent_span_id;

    if (parentId && spans.has(parentId)) {
      visit(parentId);
    }

    visiting.delete(spanId);
    visited.add(spanId);
  }

  for (const spanId of spans.keys()) {
    visit(spanId);
  }
}

export function buildTraceGraph(inputSpans: TypedTraceSpan[]): TraceGraph {
  if (inputSpans.length === 0) {
    throw new TraceGraphError('Cannot build a graph from an empty trace');
  }

  const spans = new Map<string, TypedTraceSpan>();
  const warnings: string[] = [];
  const traceId = inputSpans[0]!.trace_id;

  for (const input of inputSpans) {
    const result = TypedTraceSpanSchema.safeParse(input);

    if (!result.success) {
      throw new TraceGraphError(
        `Invalid span: ${result.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }

    const span = result.data;

    if (span.trace_id !== traceId) {
      throw new TraceGraphError(`Mixed trace IDs: ${span.trace_id} differs from ${traceId}`);
    }

    if (spans.has(span.span_id)) {
      throw new TraceGraphError(`Duplicate span ID: ${span.span_id}`);
    }

    if (new Date(span.end_ts).getTime() < new Date(span.start_ts).getTime()) {
      throw new TraceGraphError(`Invalid time range for span ${span.span_id}`);
    }

    if (span.parent_span_id === span.span_id) {
      throw new TraceGraphError(`Span ${span.span_id} cannot be its own parent`);
    }

    if (span.links.some((link) => link.span_id === span.span_id)) {
      throw new TraceGraphError(`Span ${span.span_id} cannot cause itself`);
    }

    spans.set(span.span_id, span);
  }

  validateParentCycles(spans);

  const nodes: TraceGraphNode[] = [];
  const edges: TraceGraphEdge[] = [];
  const edgeKeys = new Set<string>();

  function addEdge(source: string, target: string, type: GraphEdgeType): void {
    const key = `${type}:${source}:${target}`;

    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      edges.push({ source, target, type });
    }
  }

  for (const span of spans.values()) {
    nodes.push({
      id: span.span_id,
      type: NODE_TYPES[span.name],
      span,
    });

    if (span.parent_span_id) {
      if (spans.has(span.parent_span_id)) {
        addEdge(span.parent_span_id, span.span_id, 'PARENT_OF');
      } else {
        warnings.push(`Missing parent ${span.parent_span_id} for span ${span.span_id}`);
      }
    }

    for (const link of span.links) {
      if (spans.has(link.span_id)) {
        addEdge(span.span_id, link.span_id, 'CAUSED_BY');
      } else {
        warnings.push(`Missing cause ${link.span_id} for span ${span.span_id}`);
      }
    }
  }

  return {
    traceId,
    nodes,
    edges,
    warnings,
  };
}
