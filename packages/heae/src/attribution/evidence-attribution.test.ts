
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';
import { attributeTrace } from './evidence-attribution.js';

function loadGraph(path: URL) {
  return buildTraceGraph(
    parseTraceJsonl(readFileSync(path, 'utf8')),
  );
}

const successPath = new URL(
  '../../../../fixtures/traces/success.jsonl',
  import.meta.url,
);

const toolPath = new URL(
  '../../fixtures/tool-error.jsonl',
  import.meta.url,
);

const multiPath = new URL(
  '../../fixtures/multi-label-error.jsonl',
  import.meta.url,
);

describe('HEAE Evidence Attribution', () => {
  it('returns no hypotheses for a successful clean trace', () => {
    const report = attributeTrace(loadGraph(successPath));

    expect(report.outcome).toBe('pass');
    expect(report.hypotheses).toHaveLength(0);
    expect(report.requiresJudge).toBe(false);
  });

  it('creates an unverified tool hypothesis', () => {
    const report = attributeTrace(loadGraph(toolPath));

    expect(report.outcome).toBe('fail');

    const hypothesis = report.hypotheses.find(
      item => item.category === 'tool',
    );

    expect(hypothesis?.status).toBe('unverified');
    expect(hypothesis?.supportingRuleIds).toContain(
      'TOOL-02',
    );
    expect(hypothesis?.evidenceNodeIds).toContain(
      '1000000000000006',
    );
    expect(report.requiresJudge).toBe(true);
  });

  it('preserves multiple competing hypotheses', () => {
    const report = attributeTrace(loadGraph(multiPath));

    expect(
      report.hypotheses.map(item => item.category).sort(),
    ).toEqual(['retrieval', 'tool']);

    expect(report.hypotheses).toHaveLength(2);
  });

  it('reports uncertainty when final output is missing', () => {
    const graph = loadGraph(successPath);

    graph.nodes = graph.nodes.filter(
      node => node.span.name !== 'output',
    );

    const report = attributeTrace(graph);

    expect(report.outcome).toBe('unknown');
    expect(report.requiresJudge).toBe(true);
    expect(
      report.warnings.some(
        warning => warning.includes('No final output'),
      ),
    ).toBe(true);
  });

  it('does not invent a cause when a task fails', () => {
    const graph = loadGraph(successPath);

    const output = graph.nodes.find(
      node => node.span.name === 'output',
    );

    if (!output || output.span.name !== 'output') {
      throw new Error('Output span missing');
    }

    output.span.attributes.result = 'fail';
    output.span.status = 'error';

    const report = attributeTrace(graph);

    expect(report.hypotheses).toHaveLength(0);
    expect(report.requiresJudge).toBe(true);
    expect(
      report.warnings.some(
        warning => warning.includes('no deterministic'),
      ),
    ).toBe(true);
  });

  it('warns when error observations occur in a passing task', () => {
    const graph = loadGraph(toolPath);

    const output = graph.nodes.find(
      node => node.span.name === 'output',
    );

    if (!output || output.span.name !== 'output') {
      throw new Error('Output span missing');
    }

    output.span.attributes.result = 'pass';
    output.span.attributes.tests_run = 5;
    output.span.attributes.tests_passed = 5;
    output.span.status = 'ok';

    const report = attributeTrace(graph);

    expect(report.outcome).toBe('pass');
    expect(report.hypotheses.length).toBeGreaterThan(0);
    expect(
      report.warnings.some(
        warning => warning.includes('passed despite'),
      ),
    ).toBe(true);
  });

  it('does not mutate the original graph', () => {
    const graph = loadGraph(multiPath);
    const original = structuredClone(graph);

    attributeTrace(graph);

    expect(graph).toEqual(original);
  });
});
