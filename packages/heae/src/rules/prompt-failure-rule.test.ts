import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildTraceGraph } from '../trace-graph.js';
import { parseTraceJsonl } from '../trace-intake.js';
import { evaluateRules } from './rule-engine.js';
import { detectPromptFailures } from './prompt-failure-rule.js';

function loadGraph(path: URL) {
  return buildTraceGraph(parseTraceJsonl(readFileSync(path, 'utf8')));
}

const failurePath = new URL('../../fixtures/prompt-error.jsonl', import.meta.url);

const successPath = new URL('../../../../fixtures/traces/success.jsonl', import.meta.url);

describe('HEAE PROMPT-01 Rule', () => {
  it('detects an explicit prompt error', () => {
    const findings = detectPromptFailures(loadGraph(failurePath));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('PROMPT-01');
    expect(findings[0]?.category).toBe('prompt');
  });

  it('returns the correct prompt evidence node', () => {
    const findings = detectPromptFailures(loadGraph(failurePath));

    expect(findings[0]?.evidenceNodeIds).toEqual(['1000000000000005']);
  });

  it('preserves prompt metadata', () => {
    const findings = detectPromptFailures(loadGraph(failurePath));

    expect(findings[0]?.details.templateId).toBe('prompt_patch_gen');
    expect(findings[0]?.details.templateVersion).toBe('1.0.0');
  });

  it('does not flag successful prompt operations', () => {
    expect(detectPromptFailures(loadGraph(successPath))).toHaveLength(0);
  });

  it('registers prompt detection in the unified engine', () => {
    const result = evaluateRules(loadGraph(failurePath));

    expect(result.categories).toContain('prompt');
    expect(result.findings.some((finding) => finding.ruleId === 'PROMPT-01')).toBe(true);
  });

  it('does not modify the graph', () => {
    const graph = loadGraph(failurePath);
    const snapshot = structuredClone(graph);

    detectPromptFailures(graph);

    expect(graph).toEqual(snapshot);
  });
});
