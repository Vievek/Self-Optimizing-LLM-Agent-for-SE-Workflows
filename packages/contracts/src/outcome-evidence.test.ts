import { describe, expect, it } from 'vitest';
import { OUTCOME_EVIDENCE_SCHEMA_VERSION, OutcomeEvidenceSchema } from './outcome-evidence.js';

const validEvidence = {
  schema_version: OUTCOME_EVIDENCE_SCHEMA_VERSION,
  evidence_id: 'ev_01J9KZ7X80ABCDEFGHJKMNPQRS',
  run_id: 'run_01',
  task_id: 'django__django-11099',
  trace_id: '0123456789abcdef0123456789abcdef',
  repo: 'django/django',
  base_commit: 'fb8b75e7a9b8f2d',
  outcome: {
    resolved: false,
    tests_passed: 12,
    tests_failed: 3,
    patch_applied: true,
  },
  memory_uses: [
    {
      memory_id: 'mem_01J9KZ7X80ABCDEFGHJKMNPQRS',
      retrieved_span_id: '1000000000000003',
      cited_by_node_ids: ['node_plan_1'],
      implicated_in_failure: true,
    },
  ],
  failure_labels: [
    {
      class: 'retrieval',
      node_ids: ['node_retrieval_1'],
      confidence: 0.8,
    },
  ],
  cost: { tokens_in: 1500, tokens_out: 250, wall_ms: 14500 },
};

describe('OutcomeEvidenceSchema', () => {
  it('accepts a complete evidence record', () => {
    expect(OutcomeEvidenceSchema.safeParse(validEvidence).success).toBe(true);
  });

  it('defaults omitted memory uses and failure labels to empty arrays', () => {
    const parsed = OutcomeEvidenceSchema.parse({
      ...validEvidence,
      memory_uses: undefined,
      failure_labels: undefined,
    });
    expect(parsed.memory_uses).toEqual([]);
    expect(parsed.failure_labels).toEqual([]);
  });

  it('rejects the previous schema version', () => {
    expect(
      OutcomeEvidenceSchema.safeParse({
        ...validEvidence,
        schema_version: '1.0',
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid evidence ID', () => {
    expect(
      OutcomeEvidenceSchema.safeParse({
        ...validEvidence,
        evidence_id: 'invalid_id',
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid trace ID', () => {
    expect(
      OutcomeEvidenceSchema.safeParse({
        ...validEvidence,
        trace_id: 'invalid_trace',
      }).success,
    ).toBe(false);
  });

  it.each([-1, 1.5])('rejects invalid test counts: %s', (count) => {
    expect(
      OutcomeEvidenceSchema.safeParse({
        ...validEvidence,
        outcome: { ...validEvidence.outcome, tests_passed: count },
      }).success,
    ).toBe(false);
  });

  it.each([-0.1, 1.1])('rejects out-of-range confidence: %s', (confidence) => {
    expect(
      OutcomeEvidenceSchema.safeParse({
        ...validEvidence,
        failure_labels: [{ class: 'retrieval', node_ids: [], confidence }],
      }).success,
    ).toBe(false);
  });

  it('rejects negative execution cost', () => {
    expect(
      OutcomeEvidenceSchema.safeParse({
        ...validEvidence,
        cost: { ...validEvidence.cost, tokens_in: -1 },
      }).success,
    ).toBe(false);
  });
});
