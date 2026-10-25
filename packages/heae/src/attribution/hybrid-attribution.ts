import type { LlmProvider } from '@soa/llm';
import type { TraceGraph } from '../trace-graph.js';
import { attributeTrace, type AttributionReport } from './evidence-attribution.js';
import { judgeTrace } from './llm-judge.js';
import type { JudgeProvenance, JudgeResponse } from './judge-schema.js';

export type HybridJudgeStatus = 'completed' | 'skipped' | 'unavailable';

export interface HybridAttributionResult {
  traceId: string;
  ruleReport: AttributionReport;
  judgment: JudgeResponse | null;
  judgeStatus: HybridJudgeStatus;
  judgeProvenance?: JudgeProvenance;
  warnings: string[];
}

export interface HybridAttributionOptions {
  provider?: LlmProvider;
  model?: string;
  judgeProvenance?: JudgeProvenance;
}

export async function evaluateHybridAttribution(
  graph: TraceGraph,
  options: HybridAttributionOptions = {},
): Promise<HybridAttributionResult> {
  const ruleReport = attributeTrace(graph);
  const warnings = [...ruleReport.warnings];

  if (!ruleReport.requiresJudge) {
    return {
      traceId: ruleReport.traceId,
      ruleReport,
      judgment: null,
      judgeStatus: 'skipped',
      warnings,
    };
  }

  if (!options.provider || !options.model) {
    warnings.push('LLM judge unavailable: provider or model not configured.');

    return {
      traceId: ruleReport.traceId,
      ruleReport,
      judgment: null,
      judgeStatus: 'unavailable',
      warnings,
    };
  }

  try {
    const result = await judgeTrace(graph, {
      provider: options.provider,
      model: options.model,
    });

    if (!result.modelCalled) {
      warnings.push('LLM judge skipped: no candidate hypotheses available.');

      return {
        traceId: ruleReport.traceId,
        ruleReport,
        judgment: null,
        judgeStatus: 'skipped',
        warnings,
      };
    }

    return {
      traceId: ruleReport.traceId,
      ruleReport,
      judgment: result.judgment,
      judgeStatus: 'completed',
      judgeProvenance: options.judgeProvenance,
      warnings,
    };
  } catch (error) {
    warnings.push(
      `LLM judge unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );

    return {
      traceId: ruleReport.traceId,
      ruleReport,
      judgment: null,
      judgeStatus: 'unavailable',
      warnings,
    };
  }
}
