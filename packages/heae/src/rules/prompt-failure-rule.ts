
import type { TraceGraph } from '../trace-graph.js';
import type { RuleFinding } from './rule-types.js';

export function detectPromptFailures(
  graph: TraceGraph,
): RuleFinding[] {
  const findings: RuleFinding[] = [];

  for (const node of graph.nodes) {
    if (node.span.name !== 'prompt') {
      continue;
    }

    const span = node.span;

    if (span.status !== 'error') {
      continue;
    }

    findings.push({
      ruleId: 'PROMPT-01',
      category: 'prompt',
      observation: 'Prompt operation reported an error',
      evidenceNodeIds: [node.id],
      details: {
        templateId: span.attributes.template_id,
        templateVersion: span.attributes.template_version,
        model: span.attributes.model,
        provider: span.attributes.provider,
        tokensIn: span.attributes.tokens_in,
        tokensOut: span.attributes.tokens_out,
        spanStatus: span.status,
      },
    });
  }

  return findings;
}
