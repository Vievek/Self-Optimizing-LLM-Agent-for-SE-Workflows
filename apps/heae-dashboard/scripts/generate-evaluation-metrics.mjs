
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseTraceJsonl,
  buildTraceGraph,
  evaluateMultiLabelCases,
} from '../../../packages/heae/dist/index.js'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDirectory, '../../..')

const datasets = ['controlled-v1', 'workflow-contrast-v1']

const outputDirectory = path.join(
  root,
  'apps/heae-dashboard/public/demo-metrics',
)

await mkdir(outputDirectory, { recursive: true })

const manifest = []

for (const datasetName of datasets) {
  const datasetDirectory = path.join(
    root,
    'packages/heae/datasets',
    datasetName,
  )

  const annotationText = await readFile(
    path.join(datasetDirectory, 'annotations.json'),
    'utf8',
  )

  const annotations = JSON.parse(annotationText)
  const evaluationCases = []

  for (const annotation of annotations.annotations) {
    const tracePath = path.join(
      datasetDirectory,
      annotation.traceFile,
    )

    const jsonl = await readFile(tracePath, 'utf8')
    const spans = parseTraceJsonl(jsonl)
    const graph = buildTraceGraph(spans)

    evaluationCases.push({
      id: annotation.caseId,
      graph,
      expectedCategories: annotation.expectedCategories,
    })
  }

  const metrics = evaluateMultiLabelCases(evaluationCases)

  const snapshot = {
    datasetName,
    provenance: 'synthetic_development',
    annotationStatus: 'draft',
    evaluationMode: 'deterministic_rules',
    independentlyValidated: false,
    annotationSha256: createHash('sha256')
      .update(annotationText)
      .digest('hex'),
    metrics,
  }

  await writeFile(
    path.join(outputDirectory, `${datasetName}.json`),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  )

  manifest.push({
    datasetName,
    totalCases: metrics.totalCases,
    exactMatches: metrics.exactMatches,
    microF1: metrics.microF1,
    macroF1: metrics.macroF1,
  })

  console.log(
    `${datasetName}: ${metrics.exactMatches}/${metrics.totalCases} ` +
    `exact matches; micro-F1=${metrics.microF1.toFixed(4)}`,
  )
}

await writeFile(
  path.join(outputDirectory, 'index.json'),
  `${JSON.stringify({
    provenance: 'synthetic_development',
    independentlyValidated: false,
    datasets: manifest,
  }, null, 2)}\n`,
  'utf8',
)

console.log('\nHEAE evaluation metrics generated successfully.')
