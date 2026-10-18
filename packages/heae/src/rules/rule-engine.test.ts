
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildTraceGraph } from '../trace-graph.js';
import { parseTraceJsonl } from '../trace-intake.js';
import {
  evaluateRules,
  type RuleDetector,
} from './rule-engine.js';

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

const retrievalPath = new URL(
  '../../fixtures/retrieval-empty.jsonl',
  import.meta.url,
);

describe('HEAE Unified Rule Engine', () => {
  it('returns no findings for a successful trace', () => {
    const result = evaluateRules(loadGraph(successPath));

    expect(result.findings).toHaveLength(0);
    expect(result.categories).toEqual([]);
  });

  it('aggregates tool error findings', () => {
    const result = evaluateRules(loadGraph(toolPath));

    expect(result.categories).toContain('tool');
    expect(result.findings[0]?.ruleId).toBe('TOOL-02');
  });

  it('aggregates retrieval observations', () => {
    const result = evaluateRules(loadGraph(retrievalPath));

    expect(result.categories).toContain('retrieval');
    expect(result.findings[0]?.ruleId).toBe('RETRIEVAL-01');
  });

  it('supports multiple categories in one trace', () => {
    const graph = loadGraph(toolPath);

    const retrievalNode = graph.nodes.find(
      (node) => node.span.name === 'retrieval',
    );

    if (!retrievalNode || retrievalNode.span.name !== 'retrieval') {
      throw new Error('Retrieval node missing');
    }

    retrievalNode.span.attributes.result_ids = [];

    const result = evaluateRules(graph);

    expect(result.categories).toContain('tool');
    expect(result.categories).toContain('retrieval');
    expect(result.findings).toHaveLength(2);
  });

  it('deduplicates identical findings', () => {
    const graph = loadGraph(toolPath);

    const duplicateRule: RuleDetector = () => [
      {
        ruleId: 'TOOL-02',
        category: 'tool',
        observation: 'Tool execution reported an error',
        evidenceNodeIds: ['1000000000000006'],
        details: {},
      },
      {
        ruleId: 'TOOL-02',
        category: 'tool',
        observation: 'Tool execution reported an error',
        evidenceNodeIds: ['1000000000000006'],
        details: {},
      },
    ];

    const result = evaluateRules(graph, [duplicateRule]);

    expect(result.findings).toHaveLength(1);
  });

  it('preserves graph warnings', () => {
    const graph = loadGraph(successPath);
    graph.warnings.push('Missing parent reference');

    const result = evaluateRules(graph);

    expect(result.warnings).toContain(
      'Missing parent reference',
    );
  });

  it('does not mutate the input graph', () => {
    const graph = loadGraph(toolPath);
    const original = structuredClone(graph);

    evaluateRules(graph);

    expect(graph).toEqual(original);
  });
});
