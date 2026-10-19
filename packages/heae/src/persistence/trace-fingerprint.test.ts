
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseTraceJsonl } from '../trace-intake.js';
import {
  buildTraceGraph,
  type TraceGraph,
} from '../trace-graph.js';

import { fingerprintTraceGraph } from './trace-fingerprint.js';

const content = readFileSync(
  new URL('../../fixtures/tool-error.jsonl', import.meta.url),
  'utf8',
);

function fixtureGraph(): TraceGraph {
  return buildTraceGraph(parseTraceJsonl(content));
}

describe('HEAE trace fingerprint', () => {
  it('produces a valid SHA-256 fingerprint', () => {
    const fingerprint =
      fingerprintTraceGraph(fixtureGraph());

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same fingerprint for equivalent graphs', () => {
    const graph = fixtureGraph();

    const reordered: TraceGraph = {
      warnings: structuredClone(graph.warnings),
      edges: structuredClone(graph.edges),
      nodes: structuredClone(graph.nodes),
      traceId: graph.traceId,
    };

    expect(fingerprintTraceGraph(reordered))
      .toBe(fingerprintTraceGraph(graph));
  });

  it('detects changes to graph metadata', () => {
    const original = fixtureGraph();
    const modified = structuredClone(original);

    modified.warnings.push('Changed graph metadata');

    expect(fingerprintTraceGraph(modified))
      .not.toBe(fingerprintTraceGraph(original));
  });
});
