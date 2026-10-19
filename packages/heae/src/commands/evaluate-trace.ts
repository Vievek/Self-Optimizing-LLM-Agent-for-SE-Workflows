
import type { LlmProvider } from '@soa/llm';
import type { Store } from '@soa/store';

import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph } from '../trace-graph.js';

import {
  evaluateHybridAttribution,
  type HybridAttributionResult,
} from '../attribution/hybrid-attribution.js';

import { EvaluationHistory } from '../persistence/evaluation-history.js';

import type { InteractionGraphStore } from '../persistence/interaction-graph-store.js';

/**
 * Configuration for trace evaluation.
 */
export interface EvaluateTraceOptions {
  // Optional pretrained LLM judge.
  provider?: LlmProvider;
  model?: string;

  // Optional FileStore for evaluation reports.
  store?: Store;

  // Optional Kuzu graph store.
  graphStore?: InteractionGraphStore;
}

/**
 * Summary returned to CLI, TUI, or other components.
 */
export interface EvaluateTraceSummary {
  traceId: string;

  outcome: HybridAttributionResult['ruleReport']['outcome'];

  categories: string[];

  observationCount: number;
  hypothesisCount: number;

  judgeStatus: HybridAttributionResult['judgeStatus'];

  // Whether FileStore successfully saved the report.
  saved: boolean;

  // Whether Kuzu successfully saved the trace graph.
  graphSaved: boolean;

  warnings: string[];
}

/**
 * Complete evaluation response.
 */
export interface EvaluateTraceResult {
  summary: EvaluateTraceSummary;
  attribution: HybridAttributionResult;
}

/**
 * Indicates that one or more persistence operations failed.
 *
 * Kuzu and FileStore do not share a transaction.
 * Therefore, one may succeed while the other fails.
 */
export class EvaluationPersistenceError extends Error {
  constructor(
    message: string,
    public readonly reportSaved: boolean,
    public readonly graphSaved: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'EvaluationPersistenceError';
  }
}

/**
 * Evaluate an execution trace using HEAE.
 *
 * Workflow:
 * 1. Validate JSONL trace spans.
 * 2. Construct the typed trace graph.
 * 3. Perform rule-based and optional LLM attribution.
 * 4. Check existing persistence records.
 * 5. Persist the trace graph to Kuzu, if configured.
 * 6. Persist the attribution report to FileStore, if configured.
 * 7. Return the evaluation summary and attribution.
 *
 * Persistence is optional for backward compatibility.
 */
export async function evaluateTrace(
  jsonlContent: string,
  options: EvaluateTraceOptions = {},
): Promise<EvaluateTraceResult> {
  // STEP 1: Parse and validate the incoming trace.
  const spans = parseTraceJsonl(jsonlContent);

  // STEP 2: Build the typed interaction graph.
  const graph = buildTraceGraph(spans);

  // STEP 3: Run deterministic rules and optional LLM judging.
  const attribution = await evaluateHybridAttribution(graph, {
    provider: options.provider,
    model: options.model,
  });

  // STEP 4: Prepare optional evaluation history storage.
  const history = options.store
    ? new EvaluationHistory(options.store)
    : undefined;

  // Prevent overwriting an existing evaluation report.
  if (history) {
    const existingReport = await history.load(
      graph.traceId,
    );

    if (existingReport) {
      throw new Error(
        `Evaluation already exists: ${graph.traceId}`,
      );
    }
  }

  // Prevent overwriting an existing Kuzu interaction graph.
  if (options.graphStore) {
    const existingGraph = await options.graphStore.loadGraph(
      graph.traceId,
    );

    if (existingGraph) {
      throw new Error(
        `Interaction graph already exists: ${graph.traceId}`,
      );
    }
  }

  // STEP 5: Track persistence independently.
  let graphSaved = false;
  let reportSaved = false;

  try {
    // Save the interaction graph into Kuzu.
    if (options.graphStore) {
      await options.graphStore.saveGraph(graph);
      graphSaved = true;
    }

    // Save the hybrid attribution result into FileStore.
    if (history) {
      await history.save(attribution);
      reportSaved = true;
    }
  } catch (error) {
    // These databases do not share an atomic transaction.
    // Report partial success rather than hiding it.
    throw new EvaluationPersistenceError(
      `HEAE persistence failed for ${graph.traceId}. ` +
        `Graph saved: ${graphSaved}. ` +
        `Report saved: ${reportSaved}. ` +
        'Inspect both stores before retrying.',
      reportSaved,
      graphSaved,
      { cause: error },
    );
  }

  // STEP 6: Build the structured evaluation summary.
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

    saved: reportSaved,
    graphSaved,

    warnings: [...attribution.warnings],
  };

  // STEP 7: Return the summary and full attribution.
  return {
    summary,
    attribution,
  };
}
