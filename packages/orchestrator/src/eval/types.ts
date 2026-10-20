/**
 * Evaluation metrics for the 100-task simulated run (proposal Tables 1–2).
 * Filled in after the optimizer pipeline exists; this file is the contract
 * for what that run must report. No real model calls.
 */
export interface OrchEvalMetrics {
  /** Task success rate, last-20 vs first-20 of the 100-task window. */
  successRateDelta: number;
  /** Coefficient of variation of config-update magnitude, tasks 51–100. Target < 0.15. */
  configStabilityCv: number;
  /** Median tasks until rollback after a regressive update. Target < 2. */
  regressionRecoveryTasks: number;
  /** Correlation between HEAE confidence and observed improvement. */
  updateUsefulnessPearson: number;
}

export interface SimulatedTaskOutcome {
  taskIndex: number;
  taskId: string;
  success: boolean;
  tokens: number;
  configVersion: string;
  rolledBack: boolean;
}

export const EMPTY_ORCH_EVAL_METRICS: OrchEvalMetrics = {
  successRateDelta: 0,
  configStabilityCv: 0,
  regressionRecoveryTasks: 0,
  updateUsefulnessPearson: 0,
};
