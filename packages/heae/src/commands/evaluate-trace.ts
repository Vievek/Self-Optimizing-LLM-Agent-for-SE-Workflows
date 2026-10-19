
import type { LlmProvider } from '@soa/llm';
import type { Store } from '@soa/store';

import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';
import {
  evaluateHybridAttribution,
  type HybridAttributionResult,
} from '../attribution/hybrid-attribution.js';
import { EvaluationHistory } from '../persistence/evaluation-history.js';

export interface EvaluateTraceOptions {
  provider?: LlmProvider;
  model?: string;

  // If omitted, evaluation is performed without persistence.
  store?: Store;
}

export interface EvaluateTraceSummary {
  traceId: string;
  outcome: HybridAttributionResult['ruleReport']['outcome'];
  categories: string[];
  observationCount: number;
  hypothesisCount: number;
  judgeStatus: HybridAttributionResult['judgeStatus'];
  saved: boolean;
  warnings: string[];
}

export interface EvaluateTraceResult {
  summary: EvaluateTraceSummary;
  attribution: HybridAttributionResult;
}

export async function evaluateTrace(
  jsonlContent: string,
  options: EvaluateTraceOptions = {},
): Promise<EvaluateTraceResult> {
  // 1. Validate the incoming JSONL records.
  const spans = parseTraceJsonl(jsonlContent);

  // 2. Construct the evidence graph.
  const graph = buildTraceGraph(spans);

  // 3. Run deterministic attribution and optional LLM judging.
  const attribution = await evaluateHybridAttribution(graph, {
    provider: options.provider,
    model: options.model,
  });

  // 4. Persist only when an actual store is supplied.
  let saved = false;

  if (options.store) {
    const history = new EvaluationHistory(options.store);

    // Failed writes and duplicate records are propagated to the caller.
    // Do not incorrectly report that persistence succeeded.
    await history.save(attribution);
    saved = true;
  }

  // 5. Return a structured result usable by CLI or TUI.
  const summary: EvaluateTraceSummary = {
    traceId: attribution.traceId,
    outcome: attribution.ruleReport.outcome,
    categories: [
      ...new Set(
        attribution.ruleReport.observations.map(
          (finding) => finding.category,
        ),
      ),
    ],
    observationCount:
      attribution.ruleReport.observations.length,
    hypothesisCount:
      attribution.ruleReport.hypotheses.length,
    judgeStatus: attribution.judgeStatus,
    saved,
    warnings: [...attribution.warnings],
  };

  return {
    summary,
    attribution,
  };
}
