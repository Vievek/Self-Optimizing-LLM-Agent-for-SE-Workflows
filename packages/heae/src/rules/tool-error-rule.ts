import type { TraceGraph } from '../trace-graph.js';
import type { RuleFinding } from './rule-types.js';

export function detectToolErrors(graph: TraceGraph): RuleFinding[] {
  const findings: RuleFinding[] = [];

  for (const node of graph.nodes) {
    if (node.span.name !== 'tool_call') {
      continue;
    }

    const span = node.span;
    const attributes = span.attributes;

    const failed = span.status === 'error' || attributes.status === 'error';

    if (!failed) {
      continue;
    }

    // A completed test run with a failed assertion is not
    // necessarily a malfunction of the test execution tool.
    //
    // Only exclude a clearly identified assertion failure
    // when the trace confirms that tests actually ran.
    const error = attributes.error;

    const testsRun = attributes.tests_run;
    const testsFailed = attributes.tests_failed;

    const isCompletedTestAssertionFailure =
      attributes.tool_name === 'run_tests' &&
      typeof error === 'string' &&
      error.startsWith('TEST_ASSERTION_FAILED:') &&
      typeof testsRun === 'number' &&
      Number.isInteger(testsRun) &&
      testsRun > 0 &&
      typeof testsFailed === 'number' &&
      Number.isInteger(testsFailed) &&
      testsFailed > 0 &&
      testsFailed <= testsRun;

    if (isCompletedTestAssertionFailure) {
      continue;
    }

    findings.push({
      ruleId: 'TOOL-02',
      category: 'tool',
      observation: 'Tool execution reported an error',
      evidenceNodeIds: [node.id],
      details: {
        toolName: attributes.tool_name,
        error: attributes.error,
        spanStatus: span.status,
        toolStatus: attributes.status,
        latencyMs: attributes.latency_ms,
      },
    });
  }

  return findings;
}
