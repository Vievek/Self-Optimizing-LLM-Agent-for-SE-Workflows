
import type { TraceGraph } from '../trace-graph.js';
import type { RuleFinding } from './rule-types.js';

export function detectWorkflowFailures(
  graph: TraceGraph,
): RuleFinding[] {
  const findings: RuleFinding[] = [];

  const patchTools = graph.nodes.filter(
    (node) =>
      node.span.name === 'tool_call' &&
      node.span.status === 'ok' &&
      node.span.attributes.status === 'ok' &&
      node.span.attributes.tool_name === 'apply_patch',
  );

  for (const node of graph.nodes) {
    if (node.span.name !== 'output') {
      continue;
    }

    const span = node.span;
    const output = span.attributes;

    const unsuccessful = output.result !== 'pass';
    const noTests = output.tests_run === 0;
    const hasPatchEvidence = patchTools.length > 0;

    if (!unsuccessful || !noTests || !hasPatchEvidence) {
      continue;
    }

    findings.push({
      ruleId: 'WORKFLOW-01',
      category: 'workflow',
      observation:
        'Patch operation succeeded, but the unsuccessful output reports no tests executed',
      evidenceNodeIds: [
        ...new Set([
          node.id,
          ...patchTools.map((tool) => tool.id),
        ]),
      ],
      details: {
        result: output.result,
        testsRun: output.tests_run,
        patchHash: output.patch_hash,
        patchToolCount: patchTools.length,
        outputSpanStatus: span.status,
      },
    });
  }

  return findings;
}
