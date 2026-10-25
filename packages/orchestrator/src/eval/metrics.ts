import type { OrchEvalMetrics, SimulatedTaskOutcome } from './types.js';

export interface MetricRunData {
  outcomes: SimulatedTaskOutcome[];
  updateMagnitudes: number[];
  usefulnessSamples: Array<{
    confidence: number;
    successDelta: number;
  }>;
  recoveryTasks: number[];
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 0;

  const average = mean(values);
  if (average === 0) return 0;

  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance) / Math.abs(average);
}

function pearsonCorrelation(pairs: Array<{ confidence: number; successDelta: number }>): number {
  if (pairs.length < 2) return 0;

  const xs = pairs.map((pair) => pair.confidence);
  const ys = pairs.map((pair) => pair.successDelta);
  const xMean = mean(xs);
  const yMean = mean(ys);

  const numerator = mean(
    xs.map((x, i) => {
      const y = ys[i] ?? yMean;
      return (x - xMean) * (y - yMean);
    }),
  );
  const xStd = Math.sqrt(mean(xs.map((x) => (x - xMean) ** 2)));
  const yStd = Math.sqrt(mean(ys.map((y) => (y - yMean) ** 2)));

  if (xStd === 0 || yStd === 0) return 0;

  return Math.max(-1, Math.min(1, numerator / (xStd * yStd)));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle];

  if (middleValue === undefined) return 0;

  if (sorted.length % 2 !== 0) {
    return middleValue;
  }

  const previousValue = sorted[middle - 1];

  if (previousValue === undefined) return middleValue;

  return (previousValue + middleValue) / 2;
}

export function computeMetrics(data: MetricRunData): OrchEvalMetrics {
  const { outcomes } = data;

  const first = outcomes.slice(0, 20);
  const last = outcomes.slice(-20);

  const successRateDelta =
    mean(last.map((outcome) => Number(outcome.success))) -
    mean(first.map((outcome) => Number(outcome.success)));

  // Tasks 51–100, using zero for tasks without an update.
  const laterMagnitudes = data.updateMagnitudes.slice(50, 100);

  return {
    successRateDelta,
    configStabilityCv: coefficientOfVariation(laterMagnitudes),
    regressionRecoveryTasks: median(data.recoveryTasks),
    updateUsefulnessPearson: pearsonCorrelation(data.usefulnessSamples),
  };
}
