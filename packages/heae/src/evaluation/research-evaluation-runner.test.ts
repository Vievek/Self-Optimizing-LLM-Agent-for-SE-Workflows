import { copyFile, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  runResearchEvaluation,
  type ResearchEvaluationManifest,
} from './research-evaluation-runner.js';

const fixtureDirectory = new URL('../../fixtures/', import.meta.url);

const successFixture = new URL('../../../../fixtures/traces/success.jsonl', import.meta.url);

const toolFixture = new URL('tool-error.jsonl', fixtureDirectory);

let datasetDirectory: string;

function makeManifest(): ResearchEvaluationManifest {
  return {
    datasetName: 'HEAE synthetic regression dataset',
    datasetVersion: '1.0',
    cases: [
      {
        id: 'successful-execution',
        traceFile: 'success.jsonl',
        expectedCategories: [],
      },
      {
        id: 'tool-failure',
        traceFile: 'tool-error.jsonl',
        expectedCategories: ['tool'],
      },
    ],
  };
}

beforeEach(async () => {
  datasetDirectory = await mkdtemp(path.join(tmpdir(), 'heae-research-eval-'));

  await copyFile(successFixture, path.join(datasetDirectory, 'success.jsonl'));

  await copyFile(toolFixture, path.join(datasetDirectory, 'tool-error.jsonl'));
});

afterEach(async () => {
  await rm(datasetDirectory, {
    recursive: true,
    force: true,
  });
});

describe('HEAE research evaluation runner', () => {
  it('evaluates a labelled synthetic dataset', async () => {
    const report = await runResearchEvaluation(datasetDirectory, makeManifest());

    expect(report.datasetName).toBe('HEAE synthetic regression dataset');

    expect(report.datasetVersion).toBe('1.0');

    expect(report.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(report.metrics.totalCases).toBe(2);
    expect(report.metrics.exactMatches).toBe(2);
    expect(report.metrics.exactMatchAccuracy).toBe(1);
    expect(report.metrics.microF1).toBe(1);

    // Categories absent from this small dataset
    // receive F1 = 0 under the existing convention.
    expect(report.metrics.macroF1).toBeCloseTo(0.2);

    const tool = report.metrics.perCategory.find((item) => item.category === 'tool');

    expect(tool?.support).toBe(1);
    expect(tool?.truePositives).toBe(1);
    expect(tool?.f1).toBe(1);
  });

  it('rejects duplicate case IDs', async () => {
    const manifest = makeManifest();

    manifest.cases[1]!.id = manifest.cases[0]!.id;

    await expect(runResearchEvaluation(datasetDirectory, manifest)).rejects.toThrow(
      'Duplicate case ID',
    );
  });

  it('rejects invalid failure categories', async () => {
    const manifest = {
      ...makeManifest(),
      cases: [
        {
          id: 'invalid-category',
          traceFile: 'tool-error.jsonl',
          expectedCategories: ['network'],
        },
      ],
    };

    await expect(runResearchEvaluation(datasetDirectory, manifest)).rejects.toThrow();
  });

  it('rejects duplicate expected labels', async () => {
    const manifest = {
      ...makeManifest(),
      cases: [
        {
          id: 'duplicate-labels',
          traceFile: 'tool-error.jsonl',
          expectedCategories: ['tool', 'tool'],
        },
      ],
    };

    await expect(runResearchEvaluation(datasetDirectory, manifest)).rejects.toThrow(
      'Duplicate expected category',
    );
  });

  it('rejects path traversal', async () => {
    const manifest = makeManifest();

    manifest.cases[1]!.traceFile = '../outside.jsonl';

    await expect(runResearchEvaluation(datasetDirectory, manifest)).rejects.toThrow(
      'Unsafe trace path',
    );
  });

  it('rejects absolute trace paths', async () => {
    const manifest = makeManifest();

    manifest.cases[1]!.traceFile = '/tmp/outside.jsonl';

    await expect(runResearchEvaluation(datasetDirectory, manifest)).rejects.toThrow(
      'Unsafe trace path',
    );
  });

  it('rejects symlinks escaping the dataset directory', async () => {
    const outsideDirectory = await mkdtemp(path.join(tmpdir(), 'heae-outside-'));

    try {
      const outsideFile = path.join(outsideDirectory, 'outside.jsonl');

      await copyFile(toolFixture, outsideFile);

      await symlink(outsideFile, path.join(datasetDirectory, 'linked.jsonl'));

      const manifest = makeManifest();

      manifest.cases[1]!.traceFile = 'linked.jsonl';

      await expect(runResearchEvaluation(datasetDirectory, manifest)).rejects.toThrow(
        'Trace path escapes dataset directory',
      );
    } finally {
      await rm(outsideDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  it('rejects malformed execution traces', async () => {
    await writeFile(path.join(datasetDirectory, 'invalid.jsonl'), '{"bad":"trace"}\n', 'utf8');

    const manifest = makeManifest();

    manifest.cases[1]!.traceFile = 'invalid.jsonl';

    await expect(runResearchEvaluation(datasetDirectory, manifest)).rejects.toThrow(
      'Invalid trace',
    );
  });

  it('rejects missing trace files', async () => {
    const manifest = makeManifest();

    manifest.cases[1]!.traceFile = 'does-not-exist.jsonl';

    await expect(runResearchEvaluation(datasetDirectory, manifest)).rejects.toThrow(
      'Unable to read evaluation case',
    );
  });

  it('accepts traces in a dataset subdirectory', async () => {
    const tracesDirectory = path.join(datasetDirectory, 'traces');

    await mkdir(tracesDirectory, {
      recursive: true,
    });

    await copyFile(toolFixture, path.join(tracesDirectory, 'tool.jsonl'));

    const manifest = makeManifest();

    manifest.cases[1]!.traceFile = 'traces/tool.jsonl';

    const report = await runResearchEvaluation(datasetDirectory, manifest);

    expect(report.metrics.totalCases).toBe(2);
    expect(report.metrics.exactMatches).toBe(2);
  });
});
