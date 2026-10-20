import { EMPTY_ORCH_EVAL_METRICS, type OrchEvalMetrics, type SimulatedTaskOutcome } from './types.js';

export interface SimulatedRunOptions {
  /** Number of consecutive simulated tasks. Proposal default: 100. */
  taskCount?: number;
  /** When true, Orchestrator.processSignal is skipped (no-optimization baseline). */
  orchOff?: boolean;
}

/**
 * 100-task simulated evaluation loop – skeleton only.
 *
 * Later this will: load MockHeae signals, optionally call Orchestrator,
 * record success / cost / version, then compute convergence, stability,
 * and regression recovery. CI must keep MockLlmProvider; no live model calls.
 */
export async function runSimulatedTasks(
  _options: SimulatedRunOptions = {},
): Promise<{ outcomes: SimulatedTaskOutcome[]; metrics: OrchEvalMetrics }> {
  return { outcomes: [], metrics: { ...EMPTY_ORCH_EVAL_METRICS } };
}
