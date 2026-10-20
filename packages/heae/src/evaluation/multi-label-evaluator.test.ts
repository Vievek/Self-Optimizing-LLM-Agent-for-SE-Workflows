
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FailureCategory } from '../rules/rule-types.js';
import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';
import {
  evaluateMultiLabelCases,
  type EvaluationCase,
} from './multi-label-evaluator.js';

interface FixtureExpectation {
  fixture: string;
  expectedCategories: FailureCategory[];
  expectedRuleIds: string[];
}

const fixtureDirectory = new URL('../../fixtures/', import.meta.url);
const successFixture = new URL(
  '../../../../fixtures/traces/success.jsonl',
  import.meta.url,
);

const expectations = JSON.parse(
  readFileSync(
    new URL('expected-labels.json', fixtureDirectory),
    'utf8',
  ),
) as FixtureExpectation[];

function loadEvaluationCases(): EvaluationCase[] {
  return expectations.map(expected => {
    const path = expected.fixture === 'success.jsonl'
      ? successFixture
      : new URL(expected.fixture, fixtureDirectory);

    const content = readFileSync(path, 'utf8');

    return {
      id: expected.fixture,
      graph: buildTraceGraph(parseTraceJsonl(content)),
      expectedCategories: expected.expectedCategories,
    };
  });
}

describe('HEAE Multi-label Evaluation', () => {
  it('evaluates all seven synthetic fixtures', () => {
    const summary = evaluateMultiLabelCases(
      loadEvaluationCases(),
    );

    expect(summary.totalCases).toBe(7);
  });

  it('matches the expected observation categories', () => {
    const summary = evaluateMultiLabelCases(
      loadEvaluationCases(),
    );

    expect(summary.exactMatches).toBe(7);
    expect(summary.exactMatchAccuracy).toBe(1);
  });

  it('calculates precision, recall and F1', () => {
    const summary = evaluateMultiLabelCases(
      loadEvaluationCases(),
    );

    expect(summary.microPrecision).toBe(1);
    expect(summary.microRecall).toBe(1);
    expect(summary.microF1).toBe(1);
  });

  it('returns both tool and retrieval findings', () => {
    const summary = evaluateMultiLabelCases(
      loadEvaluationCases(),
    );

    const multi = summary.cases.find(
      item => item.id === 'multi-label-error.jsonl',
    );

    expect(multi?.predictedCategories).toEqual([
      'retrieval',
      'tool',
    ]);

    expect(multi?.evidenceNodeIds).toEqual(
      expect.arrayContaining([
        '1000000000000003',
        '1000000000000006',
      ]),
    );
  });

  it('does not flag successful traces', () => {
    const summary = evaluateMultiLabelCases(
      loadEvaluationCases(),
    );

    const success = summary.cases.find(
      item => item.id === 'success.jsonl',
    );

    expect(success?.predictedCategories).toEqual([]);
    expect(success?.exactMatch).toBe(true);
  });

  it('reports a false positive when expected labels are absent', () => {
    const cases = loadEvaluationCases();
    const tool = cases.find(
      item => item.id === 'tool-error.jsonl',
    );

    if (!tool) {
      throw new Error('Tool fixture missing');
    }

    const summary = evaluateMultiLabelCases([
      { ...tool, expectedCategories: [] },
    ]);

    expect(summary.falsePositives).toBe(1);
    expect(summary.exactMatchAccuracy).toBe(0);
  });

  it('reports a false negative for a missing predicted label', () => {
    const cases = loadEvaluationCases();
    const success = cases.find(
      item => item.id === 'success.jsonl',
    );

    if (!success) {
      throw new Error('Success fixture missing');
    }

    const summary = evaluateMultiLabelCases([
      { ...success, expectedCategories: ['tool'] },
    ]);

    expect(summary.falseNegatives).toBe(1);
    expect(summary.microRecall).toBe(0);
  });

  it('rejects an empty evaluation dataset', () => {
    expect(() => evaluateMultiLabelCases([])).toThrow(
      'Evaluation requires at least one case',
    );
  });


  it('calculates per-category metrics for all five failure types', () => {
    const summary = evaluateMultiLabelCases(
      loadEvaluationCases(),
    );

    expect(summary.perCategory).toHaveLength(5);

    const expectedSupport = {
      prompt: 1,
      tool: 2,
      retrieval: 2,
      planning: 1,
      workflow: 4,
    };

    for (const metrics of summary.perCategory) {
      expect(metrics.support).toBe(
        expectedSupport[metrics.category],
      );

      expect(metrics.truePositives).toBe(metrics.support);
      expect(metrics.falsePositives).toBe(0);
      expect(metrics.falseNegatives).toBe(0);

      expect(metrics.precision).toBe(1);
      expect(metrics.recall).toBe(1);
      expect(metrics.f1).toBe(1);
    }
  });

  it('calculates macro-F1 across failure categories', () => {
    const summary = evaluateMultiLabelCases(
      loadEvaluationCases(),
    );

    expect(summary.macroF1).toBe(1);
  });

  it('reports a category-specific false positive', () => {
    const cases = loadEvaluationCases();

    const toolCase = cases.find(
      (item) => item.id === 'tool-error.jsonl',
    );

    if (!toolCase) {
      throw new Error('Tool fixture missing');
    }

    const summary = evaluateMultiLabelCases([
      {
        ...toolCase,
        expectedCategories: [],
      },
    ]);

    const toolMetrics = summary.perCategory.find(
      (item) => item.category === 'tool',
    );

    expect(toolMetrics?.truePositives).toBe(0);
    expect(toolMetrics?.falsePositives).toBe(1);
    expect(toolMetrics?.falseNegatives).toBe(0);
    expect(toolMetrics?.precision).toBe(0);
    expect(toolMetrics?.f1).toBe(0);
  });
});
