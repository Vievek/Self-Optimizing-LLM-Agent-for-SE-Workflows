
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';
import { detectRetrievalFailures } from './retrieval-failure-rule.js';

function loadGraph(path: URL) {
  const content = readFileSync(path, 'utf8');
  return buildTraceGraph(parseTraceJsonl(content));
}

const failurePath = new URL(
  '../../fixtures/retrieval-empty.jsonl',
  import.meta.url,
);

const successPath = new URL(
  '../../../../fixtures/traces/success.jsonl',
  import.meta.url,
);

describe('HEAE RETRIEVAL-01 Rule', () => {
  it('detects retrieval with no results', () => {
    const graph = loadGraph(failurePath);
    const findings = detectRetrievalFailures(graph);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('RETRIEVAL-01');
    expect(findings[0]?.category).toBe('retrieval');
  });

  it('returns the retrieval evidence node', () => {
    const findings = detectRetrievalFailures(loadGraph(failurePath));

    expect(findings[0]?.evidenceNodeIds).toEqual([
      '1000000000000003',
    ]);
  });

  it('preserves retrieval details', () => {
    const findings = detectRetrievalFailures(loadGraph(failurePath));

    expect(findings[0]?.details.resultCount).toBe(0);
    expect(findings[0]?.details.strategy).toBe('graph');
    expect(findings[0]?.details.source).toBe('code');
  });

  it('does not flag retrieval with results', () => {
    expect(
      detectRetrievalFailures(loadGraph(successPath)),
    ).toHaveLength(0);
  });

  it('does not mutate the input graph', () => {
    const graph = loadGraph(failurePath);
    const snapshot = structuredClone(graph);

    detectRetrievalFailures(graph);

    expect(graph).toEqual(snapshot);
  });
});
