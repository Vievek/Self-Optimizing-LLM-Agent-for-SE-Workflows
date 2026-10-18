
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildTraceGraph } from '../trace-graph.js';
import { parseTraceJsonl } from '../trace-intake.js';
import { evaluateRules } from './rule-engine.js';
import { detectWorkflowFailures } from './workflow-failure-rule.js';

function loadGraph(path: URL) {
  return buildTraceGraph(
    parseTraceJsonl(readFileSync(path, 'utf8')),
  );
}

const failurePath = new URL(
  '../../fixtures/workflow-unverified.jsonl',
  import.meta.url,
);

const successPath = new URL(
  '../../../../fixtures/traces/success.jsonl',
  import.meta.url,
);

describe('HEAE WORKFLOW-01 Rule', () => {
  it('detects an unsuccessful unverified patch workflow', () => {
    const findings = detectWorkflowFailures(loadGraph(failurePath));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('WORKFLOW-01');
    expect(findings[0]?.category).toBe('workflow');
  });

  it('returns output and patch tool evidence nodes', () => {
    const findings = detectWorkflowFailures(loadGraph(failurePath));

    expect(findings[0]?.evidenceNodeIds).toEqual([
      '1000000000000007',
      '1000000000000006',
    ]);
  });

  it('preserves workflow details', () => {
    const findings = detectWorkflowFailures(loadGraph(failurePath));

    expect(findings[0]?.details.testsRun).toBe(0);
    expect(findings[0]?.details.result).toBe('fail');
    expect(findings[0]?.details.patchToolCount).toBe(1);
  });

  it('does not flag the successful fixture', () => {
    expect(
      detectWorkflowFailures(loadGraph(successPath)),
    ).toHaveLength(0);
  });

  it('does not flag a failed task that ran tests', () => {
    const graph = loadGraph(failurePath);
    const output = graph.nodes.find(
      node => node.span.name === 'output',
    );

    if (!output || output.span.name !== 'output') {
      throw new Error('Output node missing');
    }

    output.span.attributes.tests_run = 3;
    output.span.attributes.tests_failed = 3;

    expect(detectWorkflowFailures(graph)).toHaveLength(0);
  });

  it('does not flag a workflow without successful patch application', () => {
    const graph = loadGraph(failurePath);
    const tool = graph.nodes.find(
      node => node.span.name === 'tool_call',
    );

    if (!tool || tool.span.name !== 'tool_call') {
      throw new Error('Tool node missing');
    }

    tool.span.status = 'error';
    tool.span.attributes.status = 'error';

    expect(detectWorkflowFailures(graph)).toHaveLength(0);
  });

  it('is registered in the unified rule engine', () => {
    const result = evaluateRules(loadGraph(failurePath));

    expect(result.categories).toContain('workflow');
    expect(
      result.findings.some(
        finding => finding.ruleId === 'WORKFLOW-01',
      ),
    ).toBe(true);
  });

  it('does not mutate the input graph', () => {
    const graph = loadGraph(failurePath);
    const snapshot = structuredClone(graph);

    detectWorkflowFailures(graph);

    expect(graph).toEqual(snapshot);
  });
});
