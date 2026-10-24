import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TypedTraceSpan } from '@soa/contracts';
import { parseTraceJsonl } from './trace-intake.js';
import { buildTraceGraph, TraceGraphError } from './trace-graph.js';

const fixture = readFileSync(
  new URL('../../../fixtures/traces/success.jsonl', import.meta.url),
  'utf8',
);

const successSpans = parseTraceJsonl(fixture);

function cloneSpans(): TypedTraceSpan[] {
  return structuredClone(successSpans);
}

describe('HEAE Trace Graph Builder', () => {
  it('builds the success fixture graph', () => {
    const graph = buildTraceGraph(cloneSpans());

    expect(graph.nodes).toHaveLength(7);
    expect(graph.traceId).toBe(successSpans[0]?.trace_id);
    expect(graph.warnings).toHaveLength(0);
  });

  it('preserves all seven node types', () => {
    const types = buildTraceGraph(cloneSpans()).nodes.map((node) => node.type);

    expect(types).toEqual(
      expect.arrayContaining([
        'TaskNode',
        'PlanNode',
        'RetrievalNode',
        'RouteNode',
        'PromptNode',
        'ToolCallNode',
        'OutputNode',
      ]),
    );
  });

  it('preserves parent and causal edges', () => {
    const graph = buildTraceGraph(cloneSpans());

    expect(graph.edges.filter((edge) => edge.type === 'PARENT_OF')).toHaveLength(6);

    expect(graph.edges.filter((edge) => edge.type === 'CAUSED_BY')).toHaveLength(6);
  });

  it('preserves original span metadata', () => {
    const graph = buildTraceGraph(cloneSpans());

    const toolNode = graph.nodes.find((node) => node.type === 'ToolCallNode');

    expect(toolNode?.span.name).toBe('tool_call');

    if (toolNode?.span.name === 'tool_call') {
      expect(toolNode.span.attributes.tool_name).toBe('apply_patch');
    }
  });

  it('rejects an empty trace', () => {
    expect(() => buildTraceGraph([])).toThrow(TraceGraphError);
  });

  it('rejects duplicate span IDs', () => {
    const spans = cloneSpans();
    spans.push(structuredClone(spans[0]!));

    expect(() => buildTraceGraph(spans)).toThrow('Duplicate span ID');
  });

  it('rejects mixed trace IDs', () => {
    const spans = cloneSpans();

    spans[1] = {
      ...spans[1]!,
      trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    };

    expect(() => buildTraceGraph(spans)).toThrow('Mixed trace IDs');
  });

  it('rejects invalid timestamps', () => {
    const spans = cloneSpans();

    spans[1] = {
      ...spans[1]!,
      start_ts: '2026-10-18T12:00:00.000Z',
      end_ts: '2026-10-18T11:00:00.000Z',
    };

    expect(() => buildTraceGraph(spans)).toThrow('Invalid time range');
  });

  it('rejects self-parent relationships', () => {
    const spans = cloneSpans();

    spans[1] = {
      ...spans[1]!,
      parent_span_id: spans[1]!.span_id,
    };

    expect(() => buildTraceGraph(spans)).toThrow('cannot be its own parent');
  });

  it('rejects self-causal relationships', () => {
    const spans = cloneSpans();

    spans[1] = {
      ...spans[1]!,
      links: [
        {
          span_id: spans[1]!.span_id,
          rel: 'caused_by',
        },
      ],
    };

    expect(() => buildTraceGraph(spans)).toThrow('cannot cause itself');
  });

  it('detects parent cycles', () => {
    const spans = cloneSpans();

    spans[0] = {
      ...spans[0]!,
      parent_span_id: spans[1]!.span_id,
    };

    expect(() => buildTraceGraph(spans)).toThrow('Parent cycle detected');
  });

  it('warns when a parent is missing', () => {
    const spans = cloneSpans();

    spans[1] = {
      ...spans[1]!,
      parent_span_id: 'ffffffffffffffff',
    };

    const graph = buildTraceGraph(spans);

    expect(graph.warnings.some((warning) => warning.includes('Missing parent'))).toBe(true);
  });

  it('warns when a causal reference is missing', () => {
    const spans = cloneSpans();

    spans[1] = {
      ...spans[1]!,
      links: [
        {
          span_id: 'ffffffffffffffff',
          rel: 'caused_by',
        },
      ],
    };

    const graph = buildTraceGraph(spans);

    expect(graph.warnings.some((warning) => warning.includes('Missing cause'))).toBe(true);
  });

  it('deduplicates repeated causal edges', () => {
    const spans = cloneSpans();

    const link = spans[1]!.links[0]!;
    spans[1] = {
      ...spans[1]!,
      links: [link, link],
    };

    const graph = buildTraceGraph(spans);

    const matchingEdges = graph.edges.filter(
      (edge) =>
        edge.source === spans[1]!.span_id &&
        edge.target === link.span_id &&
        edge.type === 'CAUSED_BY',
    );

    expect(matchingEdges).toHaveLength(1);
  });
});
