
import type { LlmProvider } from '@soa/llm';
import type { Store } from '@soa/store';

import { parseTraceJsonl } from '../trace-intake.js';
import { buildTraceGraph, type TraceGraph } from '../trace-graph.js';

import {
  evaluateHybridAttribution,
  type HybridAttributionResult,
} from '../attribution/hybrid-attribution.js';

import { attributeTrace } from '../attribution/evidence-attribution.js';
import {
  EvaluationHistory,
  type StoredEvaluation,
} from '../persistence/evaluation-history.js';

import type {
  InteractionGraphStore,
} from '../persistence/interaction-graph-store.js';
import { fingerprintTraceGraph } from '../persistence/trace-fingerprint.js';


export interface EvaluateTraceOptions {
  provider?: LlmProvider;
  model?: string;
  store?: Store;
  graphStore?: InteractionGraphStore;

  // Explicitly allow repair of one missing persistence record.
  // Normal duplicate protection remains enabled by default.
  recovery?: boolean;
}

export interface EvaluateTraceSummary {
  traceId: string;
  outcome: HybridAttributionResult['ruleReport']['outcome'];
  categories: string[];
  observationCount: number;
  hypothesisCount: number;
  judgeStatus: HybridAttributionResult['judgeStatus'];
  saved: boolean;
  graphSaved: boolean;
  warnings: string[];
}

export interface EvaluateTraceResult {
  summary: EvaluateTraceSummary;
  attribution: HybridAttributionResult;
}

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

function equivalent(
  left: unknown,
  right: unknown,
): boolean {
  // Graphs and rule reports are built in deterministic order.
  // This is a structural consistency check, not a cryptographic
  // trace fingerprint.
  return JSON.stringify(left) === JSON.stringify(right);
}


function assertExistingGraphMatches(
  expected: TraceGraph,
  existing: TraceGraph,
): void {
  const expectedFingerprint =
    fingerprintTraceGraph(expected);

  const existingFingerprint =
    fingerprintTraceGraph(existing);

  if (expectedFingerprint !== existingFingerprint) {
    throw new Error(
      `Recovery rejected: stored graph differs from ` +
      `incoming trace ${expected.traceId}`,
    );
  }
}



function assertExistingReportMatches(
  graph: TraceGraph,
  record: StoredEvaluation,
): void {
  const incomingFingerprint =
    fingerprintTraceGraph(graph);

  // New records have a full-trace fingerprint.
  if (record.traceFingerprint !== undefined) {
    if (
      record.traceFingerprint !== incomingFingerprint
    ) {
      throw new Error(
        `Recovery rejected: stored trace fingerprint ` +
        `differs from incoming trace ${graph.traceId}`,
      );
    }

    return;
  }

  // Backward compatibility for evaluation records
  // saved before fingerprints were introduced.
  //
  // This comparison is weaker: matching rule findings
  // do not establish that all span metadata is identical.
  const expectedRules = attributeTrace(graph);

  if (!equivalent(
    expectedRules,
    record.result.ruleReport,
  )) {
    throw new Error(
      `Recovery rejected: stored rule findings differ ` +
      `from incoming trace ${graph.traceId}`,
    );
  }
}


function summarize(
  attribution: HybridAttributionResult,
  reportSaved: boolean,
  graphSaved: boolean,
): EvaluateTraceSummary {
  return {
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
}

export async function evaluateTrace(
  jsonlContent: string,
  options: EvaluateTraceOptions = {},
): Promise<EvaluateTraceResult> {
  // 1. Validate and reconstruct the trace graph.
  const spans = parseTraceJsonl(jsonlContent);
  const graph = buildTraceGraph(spans);
  const traceFingerprint = fingerprintTraceGraph(graph);

  const history = options.store
    ? new EvaluationHistory(options.store)
    : undefined;

  // 2. Inspect both persistence destinations.
  // This happens before calling the LLM to avoid spending
  // tokens on a duplicate evaluation.
  const existingReport = history
    ? await history.load(graph.traceId)
    : null;

  const existingGraph = options.graphStore
    ? await options.graphStore.loadGraph(graph.traceId)
    : null;

  if (existingReport && existingGraph) {
    throw new Error(
      `Evaluation already exists: ${graph.traceId}`,
    );
  }

  if (
    !options.recovery &&
    (existingReport || existingGraph)
  ) {
    throw new Error(
      `Evaluation already exists: ${graph.traceId}. ` +
      'Use recovery mode only for incomplete persistence.',
    );
  }

  // Recovery is meaningful only when both destinations
  // are supplied. A missing destination cannot be repaired
  // if the caller did not configure it.
  if (
    options.recovery &&
    (!history || !options.graphStore)
  ) {
    throw new Error(
      'Recovery requires both store and graphStore',
    );
  }

  // 3. Verify existing data before attempting any repair.
  if (existingGraph) {
    assertExistingGraphMatches(graph, existingGraph);
  }

  if (existingReport) {
    assertExistingReportMatches(graph, existingReport);
  }

  // 4. Reuse an existing report instead of calling the LLM.
  // If there is no report, evaluate normally.
  const attribution = existingReport
    ? existingReport.result
    : await evaluateHybridAttribution(graph, {
        provider: options.provider,
        model: options.model,
      });

  // These flags represent whether the data exists
  // successfully, whether saved earlier or on this call.
  let graphSaved = existingGraph !== null;
  let reportSaved = existingReport !== null;

  try {
    // 5. Save only missing records.
    if (options.graphStore && !graphSaved) {
      await options.graphStore.saveGraph(graph);
      graphSaved = true;
    }

    if (history && !reportSaved) {
      await history.save(attribution, traceFingerprint);
      reportSaved = true;
    }
  } catch (error) {
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

  return {
    summary: summarize(
      attribution,
      reportSaved,
      graphSaved,
    ),
    attribution,
  };
}
