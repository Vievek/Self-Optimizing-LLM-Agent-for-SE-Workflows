import {
  RefinedMemory,
  ConsolidatedTaskSummary,
  MemoryService,
  REFINED_MEMORY_SCHEMA_VERSION,
} from '@soa/contracts';

export class MockMemoryAgent implements MemoryService {
  public readonly consolidatedSummaries: ConsolidatedTaskSummary[] = [];
  public cannedNotes: RefinedMemory[] = [];

  async retrieve(query: string, repo: string, commit: string): Promise<RefinedMemory[]> {
    if (this.cannedNotes.length > 0) {
      return structuredClone(this.cannedNotes);
    }

    return [
      {
        schema_version: REFINED_MEMORY_SCHEMA_VERSION,
        memory_id: 'mem_01J9X8ABCDEF0123456789ABCD',
        repo: repo || 'django/django',
        source_task_id: 'django__django-11099',
        verified_at_commit: commit || 'fb8b75e7a9b8f2d',
        note: {
          task: 'Fix regex validator trailing newline vulnerability',
          problem: 'UsernameValidator accepted usernames with trailing newline',
          cause: 'Regex used $ instead of \\Z for end-of-string assertion',
          files: ['django/contrib/auth/validators.py'],
          fix: 'Change regex to use \\Z',
          fix_snippet: 'regex = _lazy_re_compile(r"^[\\w.@+-]+\\Z")',
          evidence: 'Tests pass with strict regex validation',
          evidence_tests: ['tests/auth_tests/test_validators.py::test_ascii_validator'],
          keywords: ['regex', 'validator', 'auth', query].filter(Boolean),
          tags: ['django', 'security'],
        },
        links: [],
        verification: {
          status: 'verified',
          checked_at: new Date().toISOString(),
          details: 'Pattern verified against codebase commit',
        },
        score: {
          relevance: 0.9,
          correctness: 0.95,
          evidence: 0.85,
          freshness: 0.9,
          task_contribution: 0.8,
          total: 0.89,
        },
        action: 'KEEP',
        lifecycle: 'active',
        use_count: 1,
      },
    ];
  }

  async consolidate(summary: ConsolidatedTaskSummary): Promise<void> {
    this.consolidatedSummaries.push(summary);
  }
}
