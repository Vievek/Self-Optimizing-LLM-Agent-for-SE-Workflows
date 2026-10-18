
import type { TraceGraph } from '../trace-graph.js';
import type { RuleFinding } from './rule-types.js';

export function detectRetrievalFailures(
  graph: TraceGraph,
): RuleFinding[] {
  const findings: RuleFinding[] = [];

  for (const node of graph.nodes) {
    if (node.span.name !== 'retrieval') {
      continue;
    }

    const span = node.span;

    if (span.attributes.result_ids.length > 0) {
      continue;
    }

    findings.push({
      ruleId: 'RETRIEVAL-01',
      category: 'retrieval',
      observation: 'Retrieval returned no results',
      evidenceNodeIds: [node.id],
      details: {
        source: span.attributes.source,
        strategy: span.attributes.strategy,
        query: span.attributes.query,
        depth: span.attributes.depth,
        resultCount: 0,
      },
    });
  }

  return findings;
}
