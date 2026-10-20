
import { readFileSync } from 'node:fs';
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { OutcomeEvidenceSchema } from '@soa/contracts';
import { MemoryStore } from '@soa/store';

import {
  EvaluationHistory,
} from '../persistence/evaluation-history.js';

import {
  OUTCOME_EVENT_PATH,
  OPTIMIZATION_EVENT_PATH,
} from '../events/heae-event-publisher.js';

import type {
  OutcomeEvidenceInput,
} from '../evidence/outcome-evidence-generator.js';

import type {
  ReviewedOptimizationProposal,
} from '../signals/optimization-signal-generator.js';

import {
  evaluateExecutionTrace,
} from './evaluate-execution-trace.js';

import {
  publishEvaluationEvents,
} from './publish-evaluation-events.js';

/**
 * Existing HEAE synthetic fixture.
 *
 * The fixture includes seven typed execution spans
 * and a failed apply_patch tool call.
 */
const fixture = readFileSync(
  new URL(
    '../../fixtures/tool-error.jsonl',
    import.meta.url,
  ),
  'utf8',
);

const RUN_ID =
  'run_20261012T0900_memory_full_01';

const TASK_ID =
  'django__django-11099';

const TRACE_ID =
  '0123456789abcdef0123456789abcdef';

const TOOL_SPAN_ID =
  '1000000000000006';

const EVIDENCE_ID =
  'ev_heae_workflow_test_001';

/**
 * Synthetic outcome data for integration testing.
 *
 * These values are test fixtures, not independently
 * verified outcomes from a real Execution Core run.
 */
const outcomeInput: OutcomeEvidenceInput = {
  evidenceId: EVIDENCE_ID,
  runId: RUN_ID,
  taskId: TASK_ID,
  repo: 'django/django',
  baseCommit: 'fb8b75e7a9b8f2d',

  outcome: {
    resolved: false,
    tests_passed: 0,
    tests_failed: 0,
    patch_applied: false,
  },

  cost: {
    tokens_in: 1240,
    tokens_out: 260,
    wall_ms: 15000,
  },
};

/**
 * Reviewed test proposal.
 *
 * Since the evaluation does not use a real LLM,
 * the optimization signal must be skipped.
 */
const proposal: ReviewedOptimizationProposal = {
  reviewed: true,
  signalId: 'sig_heae_workflow_test_001',
  groupId: 'grp_heae_workflow_test',
  runId: RUN_ID,
  taskId: TASK_ID,

  failureClass: 'tool',

  rootCauseSummary:
    'Reviewed hypothesis about the failed patch operation.',

  evidenceNodeIds: [TOOL_SPAN_ID],

  targetAxis: 'tool',
  configPath: 'config/tools.yaml',
  affectedSubtask: 'tool_execution',
  suggestedAction: 'tool_description_refine',
  confidence: 0.8,
  configVersionAtFailure: 'cfg_0007',
};

describe('HEAE complete workflow integration', () => {
  let tempDirectory: string;
  let tracesDirectory: string;
  let store: MemoryStore;

  /**
   * Create a temporary Execution Core-style trace file
   * without modifying the real store/traces directory.
   */
  beforeEach(async () => {
    tempDirectory = await mkdtemp(
      path.join(tmpdir(), 'heae-workflow-test-'),
    );

    tracesDirectory = path.join(
      tempDirectory,
      'traces',
    );

    const runDirectory = path.join(
      tracesDirectory,
      RUN_ID,
    );

    await mkdir(runDirectory, {
      recursive: true,
    });

    await writeFile(
      path.join(
        runDirectory,
        `${TASK_ID}.jsonl`,
      ),
      fixture,
      'utf8',
    );

    store = new MemoryStore();
  });

  /**
   * Remove the temporary trace files after each test.
   */
  afterEach(async () => {
    await rm(tempDirectory, {
      recursive: true,
      force: true,
    });
  });

  /**
   * TEST 1
   * Ensure the Execution Core trace is evaluated
   * and the expected tool failure is detected.
   */
  it('evaluates a synthetic Execution Core trace', async () => {
    const result = await evaluateExecutionTrace(
      RUN_ID,
      TASK_ID,
      {
        tracesDirectory,
        store,
      },
    );

    expect(result.summary.traceId).toBe(TRACE_ID);
    expect(result.summary.outcome).toBe('fail');

    expect(result.summary.categories).toContain(
      'tool',
    );

    expect(result.summary.observationCount).toBe(1);
    expect(result.summary.hypothesisCount).toBe(1);

    const observation =
      result.attribution.ruleReport.observations[0];

    expect(observation?.ruleId).toBe('TOOL-02');

    expect(observation?.evidenceNodeIds).toContain(
      TOOL_SPAN_ID,
    );

    expect(observation?.details.toolName).toBe(
      'apply_patch',
    );

    expect(observation?.details.error).toBe(
      'PATCH_APPLY_FAILED: context mismatch',
    );
  });

  /**
   * TEST 2
   * Verify history persistence and the integrity
   * fingerprint.
   */
  it('persists evaluation history with a SHA-256 fingerprint', async () => {
    const result = await evaluateExecutionTrace(
      RUN_ID,
      TASK_ID,
      {
        tracesDirectory,
        store,
      },
    );

    expect(result.summary.saved).toBe(true);
    expect(result.summary.graphSaved).toBe(false);

    const saved = await new EvaluationHistory(
      store,
    ).load(TRACE_ID);

    expect(saved).not.toBeNull();

    expect(saved?.traceId).toBe(TRACE_ID);

    expect(saved?.traceFingerprint).toMatch(
      /^[0-9a-f]{64}$/,
    );

    expect(saved?.result.ruleReport.outcome).toBe(
      'fail',
    );
  });

  /**
   * TEST 3
   * Publish schema-valid OutcomeEvidence from
   * an existing evaluation.
   */
  it('publishes valid OutcomeEvidence from the saved evaluation', async () => {
    await evaluateExecutionTrace(
      RUN_ID,
      TASK_ID,
      {
        tracesDirectory,
        store,
      },
    );

    const publication = await publishEvaluationEvents(
      TRACE_ID,
      {
        store,
        outcomeInput,
      },
    );

    expect(publication.traceId).toBe(TRACE_ID);

    expect(publication.outcome?.status).toBe(
      'published',
    );

    expect(publication.optimization).toBeNull();

    const records = await store.readJsonl<unknown>(
      OUTCOME_EVENT_PATH,
    );

    expect(records).toHaveLength(1);

    const parsed = OutcomeEvidenceSchema.parse(
      records[0],
    );

    expect(parsed.evidence_id).toBe(EVIDENCE_ID);
    expect(parsed.trace_id).toBe(TRACE_ID);
    expect(parsed.run_id).toBe(RUN_ID);
    expect(parsed.task_id).toBe(TASK_ID);

    expect(parsed.outcome.resolved).toBe(false);
    expect(parsed.memory_uses).toEqual([]);
    expect(parsed.failure_labels).toEqual([]);
  });

  /**
   * TEST 4
   * Confirm that sequential retries don't produce
   * duplicate outcome events.
   */
  it('does not duplicate OutcomeEvidence on retry', async () => {
    await evaluateExecutionTrace(
      RUN_ID,
      TASK_ID,
      {
        tracesDirectory,
        store,
      },
    );

    const first = await publishEvaluationEvents(
      TRACE_ID,
      {
        store,
        outcomeInput,
      },
    );

    const retry = await publishEvaluationEvents(
      TRACE_ID,
      {
        store,
        outcomeInput,
      },
    );

    expect(first.outcome?.status).toBe('published');

    expect(retry.outcome?.status).toBe(
      'already_exists',
    );

    const records = await store.readJsonl(
      OUTCOME_EVENT_PATH,
    );

    expect(records).toHaveLength(1);
  });

  /**
   * TEST 5
   * Rule-only attribution must not generate an
   * unsupported optimization signal.
   */
  it('skips optimization when LLM judgment is unavailable', async () => {
    const result = await evaluateExecutionTrace(
      RUN_ID,
      TASK_ID,
      {
        tracesDirectory,
        store,
      },
    );

    expect(result.attribution.judgeStatus).toBe(
      'unavailable',
    );

    const publication = await publishEvaluationEvents(
      TRACE_ID,
      {
        store,
        outcomeInput,
        optimizationProposal: proposal,
      },
    );

    expect(publication.outcome?.status).toBe(
      'published',
    );

    expect(publication.optimization?.status).toBe(
      'skipped',
    );

    expect(
      await store.readJsonl(
        OPTIMIZATION_EVENT_PATH,
      ),
    ).toHaveLength(0);
  });

  /**
   * TEST 6
   * Re-evaluating the same trace against the same
   * store must not replace the original report.
   */
  it('rejects duplicate evaluation without overwriting history', async () => {
    await evaluateExecutionTrace(
      RUN_ID,
      TASK_ID,
      {
        tracesDirectory,
        store,
      },
    );

    const history = new EvaluationHistory(store);
    const original = await history.load(TRACE_ID);

    await expect(
      evaluateExecutionTrace(
        RUN_ID,
        TASK_ID,
        {
          tracesDirectory,
          store,
        },
      ),
    ).rejects.toThrow(
      'Evaluation already exists',
    );

    const after = await history.load(TRACE_ID);

    expect(after).toEqual(original);
  });
});
