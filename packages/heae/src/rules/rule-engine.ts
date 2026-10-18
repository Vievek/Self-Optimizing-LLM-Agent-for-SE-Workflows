
import type { TraceGraph } from '../trace-graph.js';
import type {
  FailureCategory,
  RuleFinding,
} from './rule-types.js';
import { detectToolErrors } from './tool-error-rule.js';
import { detectRetrievalFailures } from './retrieval-failure-rule.js';

export type RuleDetector = (
  graph: TraceGraph,
) => RuleFinding[];

export interface RuleEngineResult {
  traceId: string;
  findings: RuleFinding[];
  categories: FailureCategory[];
  evidenceNodeIds: string[];
  warnings: string[];
}

const DEFAULT_RULES: readonly RuleDetector[] = [
  detectToolErrors,
  detectRetrievalFailures,
];

export function evaluateRules(
  graph: TraceGraph,
  rules: readonly RuleDetector[] = DEFAULT_RULES,
): RuleEngineResult {
  const uniqueFindings = new Map<string, RuleFinding>();

  for (const rule of rules) {
    for (const finding of rule(graph)) {
      const evidenceNodeIds = [
        ...new Set(finding.evidenceNodeIds),
      ];

      const key = JSON.stringify([
        finding.ruleId,
        finding.category,
        [...evidenceNodeIds].sort(),
      ]);

      if (!uniqueFindings.has(key)) {
        uniqueFindings.set(key, {
          ...finding,
          evidenceNodeIds,
        });
      }
    }
  }

  const findings = [...uniqueFindings.values()];

  return {
    traceId: graph.traceId,
    findings,
    categories: [
      ...new Set(findings.map((finding) => finding.category)),
    ],
    evidenceNodeIds: [
      ...new Set(
        findings.flatMap((finding) => finding.evidenceNodeIds),
      ),
    ],
    warnings: [...graph.warnings],
  };
}
