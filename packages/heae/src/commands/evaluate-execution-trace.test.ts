import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MemoryStore } from '@soa/store';

import { EvaluationHistory } from '../persistence/evaluation-history.js';
import { evaluateExecutionTrace } from './evaluate-execution-trace.js';

const RUN_ID = 'run_20261019T0900_baseline_01';
const TASK_ID = 'django__django-11099';

const fixtureContent = readFileSync(
  new URL('../../fixtures/tool-error.jsonl', import.meta.url),
  'utf8',
);

describe('HEAE evaluate-execution-trace integration', () => {
  let directory: string;
  let tracesDirectory: string;

  async function writeExecutionTrace(taskId = TASK_ID, runId = RUN_ID): Promise<void> {
    const traceFile = path.join(tracesDirectory, RUN_ID, `${TASK_ID}.jsonl`);

    await mkdir(path.dirname(traceFile), {
      recursive: true,
    });

    const content = fixtureContent
      .trim()
      .split('\n')
      .map((line) => {
        const span = JSON.parse(line) as {
          name: string;
          attributes: Record<string, unknown>;
        };

        if (span.name === 'task') {
          span.attributes.run_id = runId;
          span.attributes.task_id = taskId;
        }

        return JSON.stringify(span);
      })
      .join('\n');

    await writeFile(traceFile, content, 'utf8');
  }

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'heae-evaluation-'));

    tracesDirectory = path.join(directory, 'traces');
  });

  afterEach(async () => {
    await rm(directory, {
      recursive: true,
      force: true,
    });
  });

  it('evaluates an Execution Core trace successfully', async () => {
    await writeExecutionTrace();

    const result = await evaluateExecutionTrace(RUN_ID, TASK_ID, { tracesDirectory });

    expect(result.summary.traceId).toMatch(/^[0-9a-f]{32}$/);

    expect(result.summary.categories).toContain('tool');

    expect(result.summary.observationCount).toBeGreaterThan(0);

    expect(result.summary.saved).toBe(false);
    expect(result.summary.graphSaved).toBe(false);
  });

  it('persists evaluation history and SHA-256 fingerprint', async () => {
    await writeExecutionTrace();

    const store = new MemoryStore();

    const result = await evaluateExecutionTrace(RUN_ID, TASK_ID, {
      tracesDirectory,
      store,
    });

    expect(result.summary.saved).toBe(true);

    const saved = await new EvaluationHistory(store).load(result.summary.traceId);

    expect(saved?.traceId).toBe(result.summary.traceId);

    expect(saved?.traceFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a missing execution trace file', async () => {
    await expect(evaluateExecutionTrace(RUN_ID, TASK_ID, { tracesDirectory })).rejects.toThrow(
      'Execution trace not available',
    );
  });

  it('rejects a mismatched task identity', async () => {
    await writeExecutionTrace('different-task');

    await expect(evaluateExecutionTrace(RUN_ID, TASK_ID, { tracesDirectory })).rejects.toThrow(
      'Task identity mismatch',
    );
  });

  it('rejects duplicate evaluation reports', async () => {
    await writeExecutionTrace();

    const store = new MemoryStore();

    await evaluateExecutionTrace(RUN_ID, TASK_ID, {
      tracesDirectory,
      store,
    });

    await expect(
      evaluateExecutionTrace(RUN_ID, TASK_ID, {
        tracesDirectory,
        store,
      }),
    ).rejects.toThrow('Evaluation already exists');
  });

  it('rejects invalid execution run IDs', async () => {
    await expect(
      evaluateExecutionTrace('../invalid-run', TASK_ID, { tracesDirectory }),
    ).rejects.toThrow('Invalid run ID');
  });
});
