import type { TraceGraph } from '../trace-graph.js';
import type { RuleFinding } from './rule-types.js';

export function detectWorkflowFailures(graph: TraceGraph): RuleFinding[] {
  const findings: RuleFinding[] = [];

  const patchTools = graph.nodes.filter(
    (node) =>
      node.span.name === 'tool_call' &&
      node.span.status === 'ok' &&
      node.span.attributes.status === 'ok' &&
      node.span.attributes.tool_name === 'apply_patch',
  );

  // Verification requirements may be explicitly recorded
  // on the task span.
  const taskSpans = graph.nodes.filter((node) => node.span.name === 'task');

  const verificationOptional = taskSpans.some(
    (node) => node.span.name === 'task' && node.span.attributes.verification_required === false,
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

    // No verification omission is established when
    // verification is explicitly optional.
    if (verificationOptional) {
      continue;
    }

    // Do not classify an external interruption as a
    // deliberate verification omission.
    const verificationNotReached = output.verification_status === 'not_reached';

    const interrupted = taskSpans.some(
      (task) =>
        task.span.name === 'task' &&
        typeof task.span.attributes.interruption_reason === 'string' &&
        task.span.attributes.interruption_reason.length > 0,
    );

    if (verificationNotReached && interrupted) {
      continue;
    }

    findings.push({
      ruleId: 'WORKFLOW-01',
      category: 'workflow',
      observation:
        'Patch operation succeeded, but the unsuccessful output reports no tests executed',
      evidenceNodeIds: [...new Set([node.id, ...patchTools.map((tool) => tool.id)])],
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
