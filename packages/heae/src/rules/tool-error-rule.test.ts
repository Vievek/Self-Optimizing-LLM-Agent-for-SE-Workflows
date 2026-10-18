
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';
import { detectToolErrors } from './tool-error-rule.js';

function loadGraph(path: URL) {
  const content = readFileSync(path, 'utf8');

  return buildTraceGraph(parseTraceJsonl(content));
}

const toolFailurePath = new URL(
  '../../fixtures/tool-error.jsonl',
  import.meta.url,
);

const successPath = new URL(
  '../../../../fixtures/traces/success.jsonl',
  import.meta.url,
);

describe('HEAE TOOL-02 Rule', () => {
  it('detects a failed tool operation', () => {
    const graph = loadGraph(toolFailurePath);
    const findings = detectToolErrors(graph);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('TOOL-02');
    expect(findings[0]?.category).toBe('tool');
  });

  it('returns the correct evidence node ID', () => {
    const graph = loadGraph(toolFailurePath);
    const findings = detectToolErrors(graph);

    expect(findings[0]?.evidenceNodeIds).toEqual([
      '1000000000000006',
    ]);
  });

  it('preserves recorded tool error information', () => {
    const graph = loadGraph(toolFailurePath);
    const findings = detectToolErrors(graph);

    expect(findings[0]?.details.toolName).toBe(
      'apply_patch',
    );
    expect(findings[0]?.details.error).toBe(
      'PATCH_APPLY_FAILED: context mismatch',
    );
  });

  it('does not flag successful tool operations', () => {
    const graph = loadGraph(successPath);
    const findings = detectToolErrors(graph);

    expect(findings).toHaveLength(0);
  });

  it('does not mutate the input graph', () => {
    const graph = loadGraph(toolFailurePath);
    const original = structuredClone(graph);

    detectToolErrors(graph);

    expect(graph).toEqual(original);
  });
});
