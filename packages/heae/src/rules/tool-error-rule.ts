
import type { TraceGraph } from '../trace-graph.js';

export interface RuleFinding {
  ruleId: string;
  category: 'tool';
  observation: string;
  evidenceNodeIds: string[];
  details: Record<string, unknown>;
}

export function detectToolErrors(
  graph: TraceGraph,
): RuleFinding[] {
  const findings: RuleFinding[] = [];

  for (const node of graph.nodes) {
    if (node.span.name !== 'tool_call') {
      continue;
    }

    const span = node.span;

    const failed =
      span.status === 'error' ||
      span.attributes.status === 'error';

    if (!failed) {
      continue;
    }

    findings.push({
      ruleId: 'TOOL-02',
      category: 'tool',
      observation: 'Tool execution reported an error',
      evidenceNodeIds: [node.id],
      details: {
        toolName: span.attributes.tool_name,
        error: span.attributes.error,
        spanStatus: span.status,
        toolStatus: span.attributes.status,
        latencyMs: span.attributes.latency_ms,
      },
    });
  }

  return findings;
}
