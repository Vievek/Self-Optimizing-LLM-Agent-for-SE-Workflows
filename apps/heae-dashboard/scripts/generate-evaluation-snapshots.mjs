import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluateTrace } from '../../../packages/heae/dist/commands/evaluate-trace.js'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../../..')

const datasetRoot = path.join(
  repositoryRoot,
  'packages/heae/datasets/workflow-contrast-v1',
)

const destination = path.join(
  repositoryRoot,
  'apps/heae-dashboard/public/demo-evaluations',
)

const caseIds = [
  'workflow-001',
  'workflow-002',
  'workflow-003',
  'workflow-004',
  'workflow-005',
]

await mkdir(destination, { recursive: true })

const index = []

for (const caseId of caseIds) {
  const sourcePath = path.join(
    datasetRoot,
    'traces',
    `${caseId}.jsonl`,
  )

  const jsonl = await readFile(sourcePath, 'utf8')

  // This calls the real HEAE backend.
  // No persistence store or LLM provider is supplied.
  const result = await evaluateTrace(jsonl)

  const snapshot = {
    caseId,
    source: `datasets/workflow-contrast-v1/traces/${caseId}.jsonl`,
    datasetProvenance: 'synthetic_development',
    evaluationMode: 'rule_only',
    traceSha256: createHash('sha256').update(jsonl).digest('hex'),
    summary: result.summary,
    attribution: result.attribution,
  }

  const destinationPath = path.join(
    destination,
    `${caseId}.json`,
  )

  await writeFile(
    destinationPath,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  )

  index.push({
    caseId,
    traceId: result.summary.traceId,
    outcome: result.summary.outcome,
    categories: result.summary.categories,
    observationCount: result.summary.observationCount,
    hypothesisCount: result.summary.hypothesisCount,
    judgeStatus: result.summary.judgeStatus,
  })

  console.log(
    `${caseId}: ${result.summary.categories.join(', ') || 'none'} ` +
    `(${result.summary.observationCount} observations, ` +
    `${result.summary.judgeStatus} judge)`,
  )
}

await writeFile(
  path.join(destination, 'index.json'),
  `${JSON.stringify({
    dataset: 'workflow-contrast-v1',
    provenance: 'synthetic_development',
    evaluationMode: 'rule_only',
    cases: index,
  }, null, 2)}\n`,
  'utf8',
)

console.log(`\nGenerated ${index.length} HEAE evaluation snapshots.`)
