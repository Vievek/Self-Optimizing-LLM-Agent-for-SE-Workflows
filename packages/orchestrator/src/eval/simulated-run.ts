import {
  EMPTY_ORCH_EVAL_METRICS,
  type OrchEvalMetrics,
  type SimulatedTaskOutcome,
} from './types.js';
import type { OptimizationOrchestrator } from '../orchestrator.js';

export interface SimulatedRunOptions {
  taskCount?: number;
  orchOff?: boolean;
  orchestrator?: OptimizationOrchestrator;
}

export async function runSimulatedTasks(
  options: SimulatedRunOptions = {},
): Promise<{ outcomes: SimulatedTaskOutcome[]; metrics: OrchEvalMetrics }> {
  const taskCount = options.taskCount ?? 100;
  const outcomes: SimulatedTaskOutcome[] = [];

  let configVersion = options.orchestrator?.configStore.getActiveVersion() ?? 'cfg_0001';

  for (let taskIndex = 0; taskIndex < taskCount; taskIndex++) {
    // Deterministic sample: first five tasks fail, remaining tasks succeed.
    // Replace this with your actual simulated task runner when available.
    const success = taskIndex >= 5;

    let rolledBack = false;

    if (!options.orchOff && options.orchestrator) {
      const previousVersion = configVersion;

      const rolledBackTo = await options.orchestrator.recordTaskOutcome(taskIndex, success);

      configVersion = options.orchestrator.configStore.getActiveVersion();

      rolledBack = rolledBackTo !== null && configVersion !== previousVersion;
    }

    outcomes.push({
      taskIndex,
      taskId: `task_${String(taskIndex + 1).padStart(3, '0')}`,
      success,
      tokens: 0,
      configVersion,
      rolledBack,
    });
  }

  return {
    outcomes,
    metrics: { ...EMPTY_ORCH_EVAL_METRICS },
  };
}
