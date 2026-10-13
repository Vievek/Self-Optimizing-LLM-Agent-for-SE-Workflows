import { describe, it, expect } from 'vitest';
import {
  RefinedMemorySchema,
  REFINED_MEMORY_SCHEMA_VERSION,
  computeTotalScore,
} from './refined-memory.js';

const base = {
  schema_version: REFINED_MEMORY_SCHEMA_VERSION,
  memory_id: 'mem_01J9KZ7X80ABCDEFGHJKMNPQRS',
  repo: 'django/django',
  source_task_id: 'django__django-11099',
  verified_at_commit: 'fb8b75e7a9b8f2d',
  note: {
    task: 'Fix ASCII UsernameValidator trailing newline',
    problem: 'Regex used $ instead of \\Z',
    cause: 're.match with $ matches newline at end of string',
    files: ['django/contrib/auth/validators.py'],
    fix: 'Change regex to use \\Z',
    fix_snippet: "regex = r'^[\\w.@+-]+\\Z'",
    evidence: 'test_ascii_validator passes with newline rejected',
    evidence_tests: ['auth_tests/test_validators.py::UsernameValidatorsTests'],
    keywords: ['username', 'validator', 'regex'],
    tags: ['auth', 'validation'],
  },
  links: [],
  verification: {
    status: 'verified',
    checked_at: new Date().toISOString(),
    details: 'Checked against base commit in sandbox',
  },
  score: {
    relevance: 0.95,
    correctness: 1.0,
    evidence: 0.9,
    freshness: 1.0,
    task_contribution: 0.8,
    total: 0.94,
  },
  action: 'KEEP',
  lifecycle: 'active',
  use_count: 1,
};

describe('RefinedMemorySchema Contract Tests', () => {
  it('validates a refined memory note with verification and score', () => {
    expect(() => RefinedMemorySchema.parse(base)).not.toThrow();
  });

  it('defaults fix_snippet and evidence_tests when omitted (backward compatible)', () => {
    const oldNote: Partial<typeof base.note> = { ...base.note };
    delete oldNote.fix_snippet;
    delete oldNote.evidence_tests;
    const parsed = RefinedMemorySchema.parse({ ...base, note: oldNote });
    expect(parsed.note.fix_snippet).toBe('');
    expect(parsed.note.evidence_tests).toEqual([]);
  });

  it('rejects a score outside 0..1', () => {
    const bad = { ...base, score: { ...base.score, total: 4.65 } };
    expect(() => RefinedMemorySchema.parse(bad)).toThrow();
  });

  it('rejects an unknown verification status', () => {
    const bad = { ...base, verification: { ...base.verification, status: 'maybe' } };
    expect(() => RefinedMemorySchema.parse(bad)).toThrow();
  });

  it('accepts all four actions and the not_applicable status', () => {
    for (const action of ['KEEP', 'STRENGTHEN', 'COMPRESS', 'DELETE']) {
      expect(() => RefinedMemorySchema.parse({ ...base, action })).not.toThrow();
    }
    const na = { ...base, verification: { ...base.verification, status: 'not_applicable' } };
    expect(() => RefinedMemorySchema.parse(na)).not.toThrow();
  });

  it('computeTotalScore stays within 0..1', () => {
    const { relevance, correctness, evidence, freshness, task_contribution } = base.score;
    const t = computeTotalScore({
      relevance,
      correctness,
      evidence,
      freshness,
      task_contribution,
    });
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(1);
  });
});
