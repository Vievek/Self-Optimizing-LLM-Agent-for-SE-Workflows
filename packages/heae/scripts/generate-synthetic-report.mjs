
import {
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runResearchEvaluation,
} from '../dist/evaluation/research-evaluation-runner.js';

const packageRoot = fileURLToPath(
  new URL('../', import.meta.url),
);

const repositoryRoot = path.resolve(
  packageRoot,
  '../..',
);

const fixtureRoot = path.join(
  packageRoot,
  'fixtures',
);

const labels = JSON.parse(
  await readFile(
    path.join(fixtureRoot, 'expected-labels.json'),
    'utf8',
  ),
);

const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), 'heae-synthetic-report-'),
);

try {
  const cases = [];

  for (const entry of labels) {
    const source = entry.fixture === 'success.jsonl'
      ? path.join(
          repositoryRoot,
          'fixtures',
          'traces',
          'success.jsonl',
        )
      : path.join(fixtureRoot, entry.fixture);

    await copyFile(
      source,
      path.join(temporaryDirectory, entry.fixture),
    );

    cases.push({
      id: entry.fixture,
      traceFile: entry.fixture,
      expectedCategories: entry.expectedCategories,
    });
  }

  const manifest = {
    datasetName: 'HEAE synthetic development fixtures',
    datasetVersion: '1.0',
    cases,
  };

  const report = await runResearchEvaluation(
    temporaryDirectory,
    manifest,
  );

  const outputPath = path.join(
    packageRoot,
    'reports',
    'synthetic-baseline.json',
  );

  await writeFile(
    outputPath,
    JSON.stringify({
      datasetType: 'synthetic-development-fixtures',
      independentlyValidated: false,
      ...report,
    }, null, 2) + '\n',
    'utf8',
  );

  console.log('HEAE synthetic evaluation completed');
  console.log(`Cases: ${report.metrics.totalCases}`);
  console.log(
    `Exact-match accuracy: ${report.metrics.exactMatchAccuracy}`,
  );
  console.log(`Micro-F1: ${report.metrics.microF1}`);
  console.log(`Macro-F1: ${report.metrics.macroF1}`);
  console.log(`Report: ${outputPath}`);
} finally {
  await rm(temporaryDirectory, {
    recursive: true,
    force: true,
  });
}
