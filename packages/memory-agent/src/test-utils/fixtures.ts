import {
  computeTotalScore,
  generateMemoryId,
  REFINED_MEMORY_SCHEMA_VERSION,
  type MemoryScore,
  type RefinedMemory,
} from '@soa/contracts';

type ScoreDimensions = Omit<MemoryScore, 'total'>;

export function makeScore(dims: Partial<ScoreDimensions> = {}): MemoryScore {
  const full: ScoreDimensions = {
    relevance: 0.8,
    correctness: 0.9,
    evidence: 0.7,
    freshness: 0.6,
    task_contribution: 0.5,
    ...dims,
  };
  return { ...full, total: computeTotalScore(full) };
}

export function makeNote(overrides: Partial<RefinedMemory> = {}): RefinedMemory {
  return {
    schema_version: REFINED_MEMORY_SCHEMA_VERSION,
    memory_id: generateMemoryId(),
    repo: 'django/django',
    source_task_id: 'django__django-11099',
    verified_at_commit: 'fb8b75e7a9b8f2d',
    note: {
      task: 'Fix trailing newline accepted by username validator',
      problem: 'UsernameValidator accepted usernames ending in a newline',
      cause: 'Regex used $ instead of \\Z for the end-of-string anchor',
      files: ['django/contrib/auth/validators.py'],
      fix: 'Anchor the regex with \\Z',
      fix_snippet: "regex = r'^[\\w.@+-]+\\Z'",
      evidence: 'Validator tests pass with the strict anchor',
      evidence_tests: ['tests/auth_tests/test_validators.py::test_ascii_validator'],
      keywords: ['regex', 'validator'],
      tags: ['auth'],
    },
    links: [],
    verification: {
      status: 'verified',
      checked_at: '2026-10-16T09:00:00.000Z',
      details: 'fix_snippet found and evidence tests passed',
    },
    score: makeScore(),
    action: 'KEEP',
    lifecycle: 'active',
    use_count: 0,
    ...overrides,
  };
}
