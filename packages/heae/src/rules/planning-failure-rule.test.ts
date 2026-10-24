import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildTraceGraph } from '../trace-graph.js';
import { parseTraceJsonl } from '../trace-intake.js';
import { evaluateRules } from './rule-engine.js';
import { detectPlanningFailures } from './planning-failure-rule.js';

function loadGraph(path: URL) {
  return buildTraceGraph(parseTraceJsonl(readFileSync(path, 'utf8')));
}

const failurePath = new URL('../../fixtures/planning-error.jsonl', import.meta.url);

const successPath = new URL('../../../../fixtures/traces/success.jsonl', import.meta.url);

describe('HEAE PLANNING-01 Rule', () => {
  it('detects explicit planning errors', () => {
    const findings = detectPlanningFailures(loadGraph(failurePath));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('PLANNING-01');
    expect(findings[0]?.category).toBe('planning');
  });

  it('returns the planning evidence node', () => {
    const findings = detectPlanningFailures(loadGraph(failurePath));

    expect(findings[0]?.evidenceNodeIds).toEqual(['1000000000000002']);
  });

  it('preserves planning error details', () => {
    const findings = detectPlanningFailures(loadGraph(failurePath));

    expect(findings[0]?.details.stepIndex).toBe(0);
    expect(findings[0]?.details.replanReason).toBe('plan_step_dependency_failed');
  });

  it('does not flag successful planning', () => {
    expect(detectPlanningFailures(loadGraph(successPath))).toHaveLength(0);
  });

  it('includes planning findings in the unified engine', () => {
    const result = evaluateRules(loadGraph(failurePath));

    expect(result.categories).toContain('planning');
    expect(result.findings.some((finding) => finding.ruleId === 'PLANNING-01')).toBe(true);
  });

  it('does not mutate the input graph', () => {
    const graph = loadGraph(failurePath);
    const original = structuredClone(graph);

    detectPlanningFailures(graph);

    expect(graph).toEqual(original);
  });
});
