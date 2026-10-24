import type { TraceGraph } from '../trace-graph.js';
import { evaluateRules } from '../rules/rule-engine.js';
import type { FailureCategory, RuleFinding } from '../rules/rule-types.js';

export type TaskOutcome = 'pass' | 'fail' | 'error' | 'unknown';

export interface AttributionHypothesis {
  category: FailureCategory;
  status: 'unverified';
  summary: string;
  supportingRuleIds: string[];
  evidenceNodeIds: string[];
  limitations: string[];
}

export interface AttributionReport {
  traceId: string;
  outcome: TaskOutcome;
  observations: RuleFinding[];
  hypotheses: AttributionHypothesis[];
  warnings: string[];
  requiresJudge: boolean;
}

const CATEGORY_DESCRIPTIONS: Record<FailureCategory, string> = {
  prompt: 'A prompt-related operation may have contributed',
  tool: 'A tool operation may have contributed',
  retrieval: 'A retrieval issue may have contributed',
  planning: 'A planning operation may have contributed',
  workflow: 'A workflow verification issue may have contributed',
};

function getTaskOutcome(graph: TraceGraph): TaskOutcome {
  const outputs = graph.nodes
    .filter((node) => node.span.name === 'output')
    .sort((a, b) => Date.parse(a.span.end_ts) - Date.parse(b.span.end_ts));

  const finalOutput = outputs[outputs.length - 1];

  if (!finalOutput || finalOutput.span.name !== 'output') {
    return 'unknown';
  }

  return finalOutput.span.attributes.result;
}

export function attributeTrace(graph: TraceGraph): AttributionReport {
  const ruleResult = evaluateRules(graph);
  const outcome = getTaskOutcome(graph);

  const hypotheses: AttributionHypothesis[] = [];

  for (const category of ruleResult.categories) {
    const relevantFindings = ruleResult.findings.filter((finding) => finding.category === category);

    const evidenceNodeIds = [
      ...new Set(relevantFindings.flatMap((finding) => finding.evidenceNodeIds)),
    ];

    const supportingRuleIds = [...new Set(relevantFindings.map((finding) => finding.ruleId))];

    hypotheses.push({
      category,
      status: 'unverified',
      summary: CATEGORY_DESCRIPTIONS[category],
      supportingRuleIds,
      evidenceNodeIds,
      limitations: [
        'Rule observations do not establish causality',
        'An independent attribution assessment is required',
      ],
    });
  }

  const warnings = [...ruleResult.warnings];

  if (outcome === 'unknown') {
    warnings.push('No final output span was available to determine the task outcome');
  }

  if (outcome === 'pass' && hypotheses.length > 0) {
    warnings.push('The task passed despite recorded error observations');
  }

  if ((outcome === 'fail' || outcome === 'error') && hypotheses.length === 0) {
    warnings.push('The task failed, but no deterministic attribution evidence was found');
  }

  return {
    traceId: graph.traceId,
    outcome,
    observations: ruleResult.findings,
    hypotheses,
    warnings,
    requiresJudge:
      hypotheses.length > 0 || outcome === 'fail' || outcome === 'error' || outcome === 'unknown',
  };
}
