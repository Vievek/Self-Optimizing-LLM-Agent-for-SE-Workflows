import { describe, expect, it } from 'vitest';
import {
  OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
  OptimizationSignalSchema,
} from './optimization-signal.js';

const validSignal = {
  schema_version: OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
  signal_id: 'sig_run01_task01_01',
  group_id: 'grp_001',
  run_id: 'run_01',
  task_id: 'django__django-11099',
  trace_id: '0123456789abcdef0123456789abcdef',
  failure_class: 'prompt',
  root_cause: {
    summary: 'Plan generation hallucinated an invalid flag',
    evidence_node_ids: ['prompt_node_1'],
  },
  target: {
    axis: 'prompt',
    config_path: 'prompts.plan_generation',
    affected_subtask: 'plan_generation',
  },
  suggested_action: 'prompt_rewrite',
  confidence: 0.92,
  classifier: 'llm_judge',
  config_version_at_failure: 'cfg_0007',
};

describe('OptimizationSignalSchema', () => {
  it('accepts a valid diagnosis', () => {
    expect(OptimizationSignalSchema.safeParse(validSignal).success).toBe(true);
  });

  it('accepts rule-based classification', () => {
    expect(
      OptimizationSignalSchema.safeParse({
        ...validSignal,
        classifier: 'rule',
      }).success,
    ).toBe(true);
  });

  it('rejects the previous schema version', () => {
    expect(
      OptimizationSignalSchema.safeParse({
        ...validSignal,
        schema_version: '1.0',
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid signal ID', () => {
    expect(
      OptimizationSignalSchema.safeParse({
        ...validSignal,
        signal_id: 'invalid_id',
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid trace ID', () => {
    expect(
      OptimizationSignalSchema.safeParse({
        ...validSignal,
        trace_id: 'invalid_trace',
      }).success,
    ).toBe(false);
  });

  it('rejects an unsupported failure class', () => {
    expect(
      OptimizationSignalSchema.safeParse({
        ...validSignal,
        failure_class: 'multi_label',
      }).success,
    ).toBe(false);
  });

  it('rejects an unsupported target axis', () => {
    expect(
      OptimizationSignalSchema.safeParse({
        ...validSignal,
        target: { ...validSignal.target, axis: 'invalid' },
      }).success,
    ).toBe(false);
  });

  it('rejects an unsupported suggested action', () => {
    expect(
      OptimizationSignalSchema.safeParse({
        ...validSignal,
        suggested_action: 'generate_patch',
      }).success,
    ).toBe(false);
  });

  it.each([-0.1, 1.1])('rejects out-of-range confidence: %s', (confidence) => {
    expect(
      OptimizationSignalSchema.safeParse({
        ...validSignal,
        confidence,
      }).success,
    ).toBe(false);
  });

  it('requires root-cause evidence', () => {
    expect(
      OptimizationSignalSchema.safeParse({
        ...validSignal,
        root_cause: undefined,
      }).success,
    ).toBe(false);
  });
});
