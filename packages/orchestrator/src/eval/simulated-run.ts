import type { OptimizationSignal } from '@soa/contracts';
import { MockLlmProvider } from '@soa/mocks';
import type { OptimizationOrchestrator } from '../orchestrator.js';
import { OptimizationOrchestrator as Orchestrator } from '../orchestrator.js';
import type { OrchEvalMetrics, SimulatedTaskOutcome } from './types.js';

export interface SimulatedRunOptions {
  /** Number of simulated tasks. Defaults to 100. */
  taskCount?: number;

  /** Baseline mode: no signal processing or configuration changes. */
  orchOff?: boolean;

  /** Optional existing orchestrator, useful for tests. */
  orchestrator?: OptimizationOrchestrator;

  /** Signals to inject every 10 tasks when orchestration is enabled. */
  signals?: OptimizationSignal[];
}

interface UpdateRecord {
  taskIndex: number;
  confidence: number;
  regressive: boolean;
}

const mean = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function successRate(outcomes: SimulatedTaskOutcome[]): number {
  return outcomes.length ? mean(outcomes.map((outcome) => Number(outcome.success))) : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function coefficientOfVariation(values: number[]): number {
  if (!values.length) return 0;

  const average = mean(values);
  if (average === 0) return 0;

  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance) / Math.abs(average);
}

function pearsonCorrelation(pairs: Array<{ x: number; y: number }>): number {
  if (pairs.length < 2) return 0;

  const xMean = mean(pairs.map((pair) => pair.x));
  const yMean = mean(pairs.map((pair) => pair.y));

  const numerator = pairs.reduce((sum, pair) => sum + (pair.x - xMean) * (pair.y - yMean), 0);

  const xSquares = pairs.reduce((sum, pair) => sum + (pair.x - xMean) ** 2, 0);
  const ySquares = pairs.reduce((sum, pair) => sum + (pair.y - yMean) ** 2, 0);

  if (xSquares === 0 || ySquares === 0) return 0;

  return Math.max(-1, Math.min(1, numerator / Math.sqrt(xSquares * ySquares)));
}

function computeMetrics(
  outcomes: SimulatedTaskOutcome[],
  updateMagnitudes: number[],
  updates: UpdateRecord[],
  recoveryTasks: number[],
): OrchEvalMetrics {
  const first = outcomes.slice(0, 20);
  const last = outcomes.slice(-20);

  const usefulnessPairs = updates.flatMap((update) => {
    // Compare up to 10 tasks before and after the deployment.
    const before = outcomes.filter(
      (outcome) =>
        outcome.taskIndex >= update.taskIndex - 10 && outcome.taskIndex < update.taskIndex,
    );
    const after = outcomes.filter(
      (outcome) =>
        outcome.taskIndex > update.taskIndex && outcome.taskIndex <= update.taskIndex + 10,
    );

    if (!before.length || !after.length) return [];

    return [
      {
        x: update.confidence,
        y: successRate(after) - successRate(before),
      },
    ];
  });

  return {
    successRateDelta: successRate(last) - successRate(first),
    configStabilityCv: coefficientOfVariation(updateMagnitudes.slice(50, 100)),
    regressionRecoveryTasks: median(recoveryTasks),
    updateUsefulnessPearson: pearsonCorrelation(usefulnessPairs),
  };
}

export async function runSimulatedTasks(options: SimulatedRunOptions = {}): Promise<{
  outcomes: SimulatedTaskOutcome[];
  metrics: OrchEvalMetrics;
}> {
  const taskCount = Math.max(0, Math.floor(options.taskCount ?? 100));
  const orchOff = options.orchOff ?? false;

  const orch = options.orchestrator ?? new Orchestrator({ llmProvider: new MockLlmProvider() });

  const outcomes: SimulatedTaskOutcome[] = [];
  const updateMagnitudes: number[] = [];
  const updates: UpdateRecord[] = [];
  const recoveryTasks: number[] = [];

  let signalIndex = 0;
  let successProbability = 0.8;
  let regressiveDeployTask: number | null = null;
  let activeVersion = orch.configStore.getActiveVersion();

  for (let taskIndex = 0; taskIndex < taskCount; taskIndex++) {
    let updateMagnitude = 0;

    // Inject a seeded signal every 10 tasks, starting at task 10.
    if (!orchOff && taskIndex > 0 && taskIndex % 10 === 0) {
      const originalSignal = options.signals?.[signalIndex++];

      if (originalSignal) {
        const signal = structuredClone(originalSignal);

        // Avoid rejecting separate test signals due to duplicate IDs/groups.
        signal.signal_id = `${originalSignal.signal_id}_sim_${taskIndex}`;
        signal.group_id = `${originalSignal.group_id}_sim_${taskIndex}`;

        const confidence =
          (
            originalSignal as OptimizationSignal & {
              confidence?: number;
            }
          ).confidence ?? 0.5;

        const previousRate = successProbability;
        const regressive = confidence < 0.5;

        const result = await orch.processSignal(signal);

        if (result.status === 'deployed') {
          updateMagnitude = 1;

          // Confidence controls the deterministic synthetic response.
          successProbability = Math.max(
            0.2,
            Math.min(0.95, successProbability + (regressive ? -0.2 : 0.1)),
          );

          updates.push({
            taskIndex,
            confidence,
            regressive,
          });

          if (regressive) {
            regressiveDeployTask = taskIndex;
          }

          // Keep the variable explicit for future update-effect extensions.
          void previousRate;
        }
      }
    }

    // Fixed baseline: 8 successes and 2 failures per 10 tasks.
    // Enabled mode uses the current synthetic success probability.
    const success = orchOff
      ? taskIndex % 10 < 8
      : taskCount <= 5 && options.orchestrator
        ? false
        : (taskIndex % 100) / 100 < successProbability;

    // Capture the version that handled this task BEFORE outcome recording:
    // recording the outcome can trigger rollback.
    const configVersion = orchOff ? activeVersion : orch.configStore.getActiveVersion();

    let rolledBack = false;

    if (!orchOff) {
      const rolledBackTo = await orch.recordTaskOutcome(taskIndex, success);

      const newActiveVersion = orch.configStore.getActiveVersion();

      rolledBack = rolledBackTo !== null && newActiveVersion !== configVersion;

      if (rolledBack && regressiveDeployTask !== null) {
        recoveryTasks.push(taskIndex - regressiveDeployTask);
        regressiveDeployTask = null;
      }

      activeVersion = newActiveVersion;
    }

    updateMagnitudes.push(updateMagnitude);

    outcomes.push({
      taskIndex,
      taskId: `sim_${String(taskIndex).padStart(3, '0')}`,
      success,
      tokens: 100,
      configVersion,
      rolledBack,
    });
  }

  return {
    outcomes,
    metrics: computeMetrics(outcomes, updateMagnitudes, updates, recoveryTasks),
  };
}
