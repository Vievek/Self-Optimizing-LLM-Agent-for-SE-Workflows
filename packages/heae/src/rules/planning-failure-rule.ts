import type { TraceGraph } from '../trace-graph.js';
import type { RuleFinding } from './rule-types.js';

export function detectPlanningFailures(graph: TraceGraph): RuleFinding[] {
  const findings: RuleFinding[] = [];

  for (const node of graph.nodes) {
    if (node.span.name !== 'plan') {
      continue;
    }

    const span = node.span;

    if (span.status !== 'error') {
      continue;
    }

    findings.push({
      ruleId: 'PLANNING-01',
      category: 'planning',
      observation: 'Planning operation reported an error',
      evidenceNodeIds: [node.id],
      details: {
        stepIndex: span.attributes.step_index,
        replanReason: span.attributes.replan_reason,
        spanStatus: span.status,
      },
    });
  }

  return findings;
}
