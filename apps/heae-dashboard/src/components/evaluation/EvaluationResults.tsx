
import { useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FileSearch,
  Info,
  ShieldCheck,
  XCircle,
} from 'lucide-react'

type CategoryMetric = {
  category: string
  support: number
  truePositives: number
  falsePositives: number
  falseNegatives: number
  precision: number
  recall: number
  f1: number
}

type CaseMetric = {
  id: string
  expectedCategories: string[]
  predictedCategories: string[]
  exactMatch: boolean
  falsePositives: string[]
  falseNegatives: string[]
  evidenceNodeIds: string[]
  ruleIds: string[]
}

type EvaluationMetrics = {
  totalCases: number
  exactMatches: number
  exactMatchAccuracy: number
  truePositives: number
  falsePositives: number
  falseNegatives: number
  microPrecision: number
  microRecall: number
  microF1: number
  macroF1: number
  perCategory: CategoryMetric[]
  cases: CaseMetric[]
}

type DatasetReport = {
  datasetName: string
  provenance: string
  annotationStatus: string
  evaluationMode: string
  independentlyValidated: boolean
  annotationSha256: string
  metrics: EvaluationMetrics
}

type Props = {
  onOpenTraceExplorer: (caseId: string, spanId?: string) => void
}

const datasets = [
  {
    id: 'controlled-v1',
    title: 'Controlled Pilot',
    description: 'Initial five-case development diagnostic',
  },
  {
    id: 'workflow-contrast-v1',
    title: 'Workflow Contrast',
    description: 'Rule-boundary regression scenarios',
  },
]

function percentage(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function categories(items: string[]) {
  return items.length > 0 ? items.join(', ') : 'None'
}

function MetricCard({
  label,
  value,
  description,
}: {
  label: string
  value: string
  description: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#111b2f] p-5">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-3 text-2xl font-bold text-white">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        {description}
      </p>
    </div>
  )
}

function MatchBar({
  label,
  matches,
  total,
  description,
}: {
  label: string
  matches: number
  total: number
  description: string
}) {
  const width = total > 0 ? (matches / total) * 100 : 0

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-200">{label}</p>
        <p className="font-mono text-sm text-blue-300">
          {matches}/{total}
        </p>
      </div>

      <div
        role="img"
        aria-label={`${label}: ${matches} out of ${total} exact matches`}
        className="h-3 overflow-hidden rounded-full bg-[#0b1425]"
      >
        <div
          className="h-full rounded-full bg-blue-500"
          style={{ width: `${width}%` }}
        />
      </div>

      <p className="text-xs leading-5 text-slate-500">
        {description}
      </p>
    </div>
  )
}

export default function EvaluationResults({
  onOpenTraceExplorer,
}: Props) {
  const [datasetId, setDatasetId] = useState('workflow-contrast-v1')
  const [reports, setReports] = useState<Record<string, DatasetReport>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadReports() {
      setLoading(true)
      setError(null)

      try {
        const entries = await Promise.all(
          datasets.map(async (dataset) => {
            const response = await fetch(
              `${import.meta.env.BASE_URL}demo-metrics/${dataset.id}.json`,
              { signal: controller.signal },
            )

            if (!response.ok) {
              throw new Error(`Unable to load ${dataset.id} metrics.`)
            }

            const report = (await response.json()) as DatasetReport

            if (
              report.datasetName !== dataset.id ||
              !report.metrics ||
              !Array.isArray(report.metrics.cases) ||
              !Array.isArray(report.metrics.perCategory)
            ) {
              throw new Error(`Invalid metrics for ${dataset.id}.`)
            }

            return [dataset.id, report] as const
          }),
        )

        if (!controller.signal.aborted) {
          setReports(Object.fromEntries(entries))
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load evaluation results.',
          )
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadReports()

    return () => controller.abort()
  }, [])

  const current = reports[datasetId]
  const controlled = reports['controlled-v1']
  const contrast = reports['workflow-contrast-v1']

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm text-blue-400">
          <BarChart3 size={18} />
          HEAE Research Diagnostics
        </div>

        <h2 className="text-2xl font-bold md:text-3xl">
          Evaluation Results
        </h2>

        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
          Examine deterministic classification results, category-level
          metrics, and case-level agreements from the recorded HEAE
          synthetic development datasets.
        </p>
      </header>

      <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm leading-6 text-amber-200">
        <div className="flex items-start gap-3">
          <AlertTriangle size={19} className="mt-0.5 shrink-0" />
          <p>
            These datasets contain synthetic development scenarios with
            draft annotations. The reported metrics are regression
            diagnostics, not independent validation or estimates of
            performance on real agent executions.
          </p>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-slate-400">
          Loading HEAE evaluation metrics...
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-400/30 bg-rose-400/5 p-4 text-sm text-rose-300"
        >
          {error}
        </div>
      )}

      {!loading && !error && current && (
        <>
          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-[#111b2f] p-5">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck size={19} className="text-blue-400" />
                <h3 className="font-semibold">Controlled Pilot</h3>
              </div>

              <p className="text-3xl font-bold">
                {controlled.metrics.exactMatches}/
                {controlled.metrics.totalCases}
              </p>

              <p className="mt-2 text-xs text-slate-400">
                Current deterministic rule evaluation
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#111b2f] p-5">
              <div className="mb-3 flex items-center gap-2">
                <Activity size={19} className="text-blue-400" />
                <h3 className="font-semibold">Workflow Contrast</h3>
              </div>

              <p className="text-3xl font-bold">
                {contrast.metrics.exactMatches}/
                {contrast.metrics.totalCases}
              </p>

              <p className="mt-2 text-xs text-slate-400">
                Current post-refinement development diagnostic
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111b2f] p-5 md:p-6">
            <h3 className="text-lg font-semibold">
              Development diagnostic comparison
            </h3>

            <p className="mt-2 text-xs leading-6 text-slate-400">
              The initial workflow-contrast result was recorded before
              the WORKFLOW-01 and TOOL-02 rule refinements. The current
              results were generated with the updated HEAE engine.
            </p>

            <div className="mt-6 space-y-6">
              <MatchBar
                label="Workflow Contrast — Before refinement"
                matches={2}
                total={5}
                description="Historical development report: 2 exact matches, 3 disagreements."
              />

              <MatchBar
                label="Workflow Contrast — Current"
                matches={contrast.metrics.exactMatches}
                total={contrast.metrics.totalCases}
                description="Re-evaluated using the current deterministic rules."
              />

              <MatchBar
                label="Controlled Pilot — Current"
                matches={controlled.metrics.exactMatches}
                total={controlled.metrics.totalCases}
                description="The pilot retains one disagreement involving WORKFLOW-01."
              />
            </div>

            <p className="mt-5 text-xs leading-6 text-amber-300">
              The before-and-after comparison is a rule-development
              diagnostic on the same synthetic scenarios used to refine
              the implementation, not an independent improvement estimate.
            </p>
          </section>

          <section className="flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-[#111b2f] p-4">
            <label htmlFor="dataset-select" className="text-sm font-medium">
              Inspect dataset
            </label>

            <select
              id="dataset-select"
              value={datasetId}
              onChange={(event) => setDatasetId(event.target.value)}
              className="max-w-full rounded-lg border border-white/15 bg-[#17243d] px-3 py-2 text-sm text-white"
            >
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.title} — {dataset.id}
                </option>
              ))}
            </select>

            <span className="text-xs text-slate-400">
              {datasets.find((item) => item.id === datasetId)?.description}
            </span>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Exact matches"
              value={`${current.metrics.exactMatches}/${current.metrics.totalCases}`}
              description={percentage(current.metrics.exactMatchAccuracy)}
            />

            <MetricCard
              label="Micro-F1"
              value={current.metrics.microF1.toFixed(4)}
              description="Aggregated category-level precision and recall"
            />

            <MetricCard
              label="Macro-F1"
              value={current.metrics.macroF1.toFixed(4)}
              description="Unweighted average across all five categories"
            />

            <MetricCard
              label="Classification disagreements"
              value={String(
                current.metrics.totalCases - current.metrics.exactMatches,
              )}
              description={`${current.metrics.falsePositives} FP · ${current.metrics.falseNegatives} FN`}
            />
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111b2f] p-5 md:p-6">
            <div className="mb-5 flex items-center gap-2">
              <BarChart3 size={20} className="text-blue-400" />
              <h3 className="text-lg font-semibold">
                Category-level classification
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-170 text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs text-slate-400">
                    <th className="px-3 py-3">Category</th>
                    <th className="px-3 py-3">Support</th>
                    <th className="px-3 py-3">TP</th>
                    <th className="px-3 py-3">FP</th>
                    <th className="px-3 py-3">FN</th>
                    <th className="px-3 py-3">Precision</th>
                    <th className="px-3 py-3">Recall</th>
                    <th className="px-3 py-3">F1</th>
                  </tr>
                </thead>

                <tbody>
                  {current.metrics.perCategory.map((item) => (
                    <tr
                      key={item.category}
                      className="border-b border-white/5 text-slate-300"
                    >
                      <td className="px-3 py-3 font-medium capitalize text-white">
                        {item.category}
                      </td>
                      <td className="px-3 py-3">{item.support}</td>
                      <td className="px-3 py-3">{item.truePositives}</td>
                      <td className="px-3 py-3">{item.falsePositives}</td>
                      <td className="px-3 py-3">{item.falseNegatives}</td>
                      <td className="px-3 py-3">
                        {percentage(item.precision)}
                      </td>
                      <td className="px-3 py-3">
                        {percentage(item.recall)}
                      </td>
                      <td className="px-3 py-3">
                        {percentage(item.f1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-start gap-2 text-xs leading-6 text-slate-400">
              <Info size={16} className="mt-1 shrink-0 text-blue-400" />

              <p>
                Support is the number of cases annotated with a
                category. In the HEAE evaluator, a category with no
                true positives, false positives, or false negatives
                receives F1 = 0. Consequently, macro-F1 may remain
                below 1 even when all cases match their annotations.
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111b2f] p-5 md:p-6">
            <div className="mb-5 flex items-center gap-2">
              <FileSearch size={20} className="text-blue-400" />
              <h3 className="text-lg font-semibold">
                Case-level evaluation results
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-190 text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs text-slate-400">
                    <th className="px-3 py-3">Case ID</th>
                    <th className="px-3 py-3">Expected</th>
                    <th className="px-3 py-3">Predicted</th>
                    <th className="px-3 py-3">Rule IDs</th>
                    <th className="px-3 py-3">Result</th>
                    <th className="px-3 py-3">Trace</th>
                  </tr>
                </thead>

                <tbody>
                  {current.metrics.cases.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-white/5 text-slate-300"
                    >
                      <td className="px-3 py-4 font-mono text-xs text-white">
                        {item.id}
                      </td>

                      <td className="px-3 py-4 capitalize">
                        {categories(item.expectedCategories)}
                      </td>

                      <td className="px-3 py-4 capitalize">
                        {categories(item.predictedCategories)}
                      </td>

                      <td className="px-3 py-4 font-mono text-xs">
                        {item.ruleIds.join(', ') || '—'}
                      </td>

                      <td className="px-3 py-4">
                        <div className="flex items-center gap-2">
                          {item.exactMatch ? (
                            <>
                              <CheckCircle2
                                size={16}
                                className="text-emerald-400"
                              />
                              <span className="text-emerald-300">
                                Match
                              </span>
                            </>
                          ) : (
                            <>
                              <XCircle
                                size={16}
                                className="text-amber-400"
                              />
                              <span className="text-amber-300">
                                Disagreement
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      <td className="px-3 py-4">
                        {datasetId === 'workflow-contrast-v1' ? (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenTraceExplorer(
                                item.id,
                                item.evidenceNodeIds[0],
                              )
                            }
                            className="flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200"
                          >
                            Inspect
                            <ArrowRight size={14} />
                          </button>
                        ) : (
                          <span
                            title="Controlled pilot trace snapshots are not currently included in the dashboard Trace Explorer."
                            className="text-xs text-slate-500"
                          >
                            Not loaded
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {current.metrics.cases.some((item) => !item.exactMatch) && (
            <section className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-5">
              <h3 className="mb-3 flex items-center gap-2 font-semibold text-amber-300">
                <AlertTriangle size={18} />
                Outstanding annotation disagreements
              </h3>

              {current.metrics.cases
                .filter((item) => !item.exactMatch)
                .map((item) => (
                  <div key={item.id} className="mt-3 text-sm text-slate-300">
                    <strong>{item.id}</strong>
                    <p className="mt-1 text-xs leading-6">
                      False positives:{' '}
                      {categories(item.falsePositives)} · False negatives:{' '}
                      {categories(item.falseNegatives)}
                    </p>
                  </div>
                ))}

              <p className="mt-4 text-xs leading-6 text-slate-400">
                Disagreements must be investigated rather than
                automatically changing annotations to match the engine.
              </p>
            </section>
          )}

          <footer className="space-y-2 rounded-xl border border-white/10 p-4 text-xs leading-6 text-slate-500">
            <p>Dataset: {current.datasetName}</p>
            <p>Provenance: {current.provenance}</p>
            <p>Annotation status: {current.annotationStatus}</p>
            <p>Evaluation mode: {current.evaluationMode}</p>
            <p>
              Independently validated:{' '}
              {current.independentlyValidated ? 'Yes' : 'No'}
            </p>
            <p className="break-all">
              Annotation SHA-256: {current.annotationSha256}
            </p>
          </footer>
        </>
      )}
    </div>
  )
}
