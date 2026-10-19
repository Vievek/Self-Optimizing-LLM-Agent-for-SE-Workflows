
import type { TraceGraph } from '../trace-graph.js';
import { evaluateRules } from '../rules/rule-engine.js';
import type { FailureCategory } from '../rules/rule-types.js';

export const FAILURE_CATEGORIES: readonly FailureCategory[] = [
  'prompt',
  'tool',
  'retrieval',
  'planning',
  'workflow',
];

export interface EvaluationCase {
  id: string;
  graph: TraceGraph;
  expectedCategories: FailureCategory[];
}

export interface CaseEvaluation {
  id: string;
  expectedCategories: FailureCategory[];
  predictedCategories: FailureCategory[];
  exactMatch: boolean;
  falsePositives: FailureCategory[];
  falseNegatives: FailureCategory[];
  evidenceNodeIds: string[];
  ruleIds: string[];
}

export interface EvaluationSummary {
  totalCases: number;
  exactMatches: number;
  exactMatchAccuracy: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  microPrecision: number;
  microRecall: number;
  microF1: number;
  cases: CaseEvaluation[];
}

export function evaluateMultiLabelCases(
  cases: readonly EvaluationCase[],
): EvaluationSummary {
  if (cases.length === 0) {
    throw new Error('Evaluation requires at least one case');
  }

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  const results: CaseEvaluation[] = cases.map((testCase) => {
    const result = evaluateRules(testCase.graph);

    const expected = new Set(testCase.expectedCategories);
    const predicted = new Set(result.categories);

    for (const category of [...expected, ...predicted]) {
      if (!FAILURE_CATEGORIES.includes(category)) {
        throw new Error(`Unknown failure category: ${category}`);
      }
    }

    const fp = [...predicted].filter(
      category => !expected.has(category),
    );
    const fn = [...expected].filter(
      category => !predicted.has(category),
    );

    truePositives += [...predicted].filter(
      category => expected.has(category),
    ).length;
    falsePositives += fp.length;
    falseNegatives += fn.length;

    return {
      id: testCase.id,
      expectedCategories: [...expected].sort(),
      predictedCategories: [...predicted].sort(),
      exactMatch: fp.length === 0 && fn.length === 0,
      falsePositives: fp,
      falseNegatives: fn,
      evidenceNodeIds: [...result.evidenceNodeIds],
      ruleIds: result.findings.map(f => f.ruleId),
    };
  });

  const precisionDenominator = truePositives + falsePositives;
  const recallDenominator = truePositives + falseNegatives;

  const microPrecision = precisionDenominator === 0
    ? 0
    : truePositives / precisionDenominator;

  const microRecall = recallDenominator === 0
    ? 0
    : truePositives / recallDenominator;

  const microF1 = microPrecision + microRecall === 0
    ? 0
    : 2 * microPrecision * microRecall /
      (microPrecision + microRecall);

  const exactMatches = results.filter(
    result => result.exactMatch,
  ).length;

  return {
    totalCases: cases.length,
    exactMatches,
    exactMatchAccuracy: exactMatches / cases.length,
    truePositives,
    falsePositives,
    falseNegatives,
    microPrecision,
    microRecall,
    microF1,
    cases: results,
  };
}
