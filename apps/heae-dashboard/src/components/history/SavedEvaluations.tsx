
import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Database,
  FileSearch,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'

type EvaluationSummary = {
  traceId: string
  outcome: string
  categories: string[]
  observationCount: number
  hypothesisCount: number
  judgeStatus: string
  traceFingerprint: string | null
}

type Finding = {
  ruleId: string
  category: string
  observation: string
  evidenceNodeIds: string[]
  details: Record<string, unknown>
}

type Hypothesis = {
  category: string
  status: string
  summary: string
  supportingRuleIds: string[]
  evidenceNodeIds: string[]
  limitations: string[]
}

type StoredEvaluation = {
  schemaVersion: string
  traceId: string
  traceFingerprint?: string
  result: {
    traceId: string
    judgeStatus: string
    judgment: unknown | null
    warnings: string[]
    ruleReport: {
      traceId: string
      outcome: string
      observations: Finding[]
      hypotheses: Hypothesis[]
      warnings: string[]
    }
  }
}

export default function SavedEvaluations() {
  const [evaluations, setEvaluations] = useState<EvaluationSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [record, setRecord] = useState<StoredEvaluation | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function loadList() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/evaluations', {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error('Unable to retrieve saved evaluations.')
        }

        const payload = (await response.json()) as {
          evaluations: EvaluationSummary[]
        }

        if (!Array.isArray(payload.evaluations)) {
          throw new Error('Invalid evaluation list response.')
        }

        if (!controller.signal.aborted) {
          setEvaluations(payload.evaluations)
          setSelectedId((current) =>
            payload.evaluations.some((item) => item.traceId === current)
              ? current
              : (payload.evaluations[0]?.traceId ?? null),
          )
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : 'Unknown error',
          )
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadList()
    return () => controller.abort()
  }, [reloadKey])

  useEffect(() => {
    if (!selectedId) {
      return
    }

    const controller = new AbortController()

    async function loadDetail() {
      setDetailLoading(true)
      setRecord(null)

      try {
        const response = await fetch(
          `/api/evaluations/${encodeURIComponent(selectedId!)}`,
          { signal: controller.signal },
        )

        if (!response.ok) {
          throw new Error('Unable to retrieve evaluation details.')
        }

        const payload = (await response.json()) as StoredEvaluation

        if (
          payload.traceId !== selectedId ||
          !payload.result?.ruleReport
        ) {
          throw new Error('Invalid saved evaluation response.')
        }

        if (!controller.signal.aborted) {
          setRecord(payload)
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : 'Unknown error',
          )
        }
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false)
      }
    }

    void loadDetail()
    return () => controller.abort()
  }, [selectedId, reloadKey])

  const refresh = useCallback(() => {
    setRecord(null)
    setError(null)
    setReloadKey((value) => value + 1)
  }, [])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-blue-400">
            <Database size={18} />
            HEAE Persisted Evaluation History
          </div>
          <h2 className="text-2xl font-bold md:text-3xl">
            Saved Evaluations
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
            Inspect evaluations saved by the HEAE backend through
            its read-only local API.
          </p>
        </div>

        <button
          type="button"
          onClick={refresh}
          className="flex items-center gap-2 rounded-lg border border-blue-400/25 bg-blue-400/10 px-4 py-2 text-sm text-blue-300 hover:bg-blue-400/20"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </header>

      <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm leading-6 text-amber-200">
        These records come from local HEAE persistence. Their
        provenance is not independently verified. Viewing them
        does not run an evaluation, invoke a judge, or publish
        downstream events.
      </div>

      {loading && (
        <p className="text-sm text-slate-400">
          Loading saved evaluations...
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-400/25 bg-rose-400/5 p-4 text-sm text-rose-300"
        >
          {error}
        </div>
      )}

      {!loading && (
        <>
          <div className="rounded-xl border border-white/10 bg-[#111b2f] p-5">
            <p className="text-xs text-slate-400">
              Saved evaluation records
            </p>
            <p className="mt-2 text-3xl font-bold">
              {evaluations.length}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Source: local read-only HEAE API
            </p>
          </div>

          {evaluations.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-[#111b2f] p-5">
              <p className="font-semibold">
                No persisted evaluations available
              </p>
              <p className="mt-2 text-sm text-slate-400">
                The local history directory does not currently
                contain saved evaluation records.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 xl:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.5fr)]">
              <section className="space-y-3">
                <h3 className="font-semibold">
                  Evaluation records
                </h3>

                {evaluations.map((item) => (
                  <button
                    key={item.traceId}
                    type="button"
                    onClick={() => setSelectedId(item.traceId)}
                    className={`w-full rounded-xl border p-4 text-left transition ${
                      selectedId === item.traceId
                        ? 'border-blue-400 bg-blue-400/10'
                        : 'border-white/10 bg-[#111b2f] hover:bg-white/5'
                    }`}
                  >
                    <p className="break-all font-mono text-xs text-blue-300">
                      {item.traceId}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-300">
                      <span>Outcome: {item.outcome}</span>
                      <span>
                        Categories: {item.categories.join(', ') || 'None'}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {item.observationCount} finding(s) ·{' '}
                      {item.hypothesisCount} hypothesis/hypotheses
                    </p>
                  </button>
                ))}
              </section>

              <section className="min-w-0 space-y-4 rounded-xl border border-white/10 bg-[#111b2f] p-5">
                <div className="flex items-center gap-2">
                  <FileSearch size={19} className="text-blue-400" />
                  <h3 className="font-semibold">
                    Evaluation details
                  </h3>
                </div>

                {detailLoading && (
                  <p className="text-sm text-slate-400">
                    Loading evaluation details...
                  </p>
                )}

                {record && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[
                        {
                          label: 'Outcome',
                          value: record.result.ruleReport.outcome,
                          icon: Activity,
                        },
                        {
                          label: 'LLM judge',
                          value: record.result.judgeStatus,
                          icon: ShieldCheck,
                        },
                      ].map(({ label, value, icon: Icon }) => (
                        <div
                          key={label}
                          className="rounded-lg border border-white/10 bg-[#0b1425] p-4"
                        >
                          <Icon size={18} className="text-blue-400" />
                          <p className="mt-3 text-xs text-slate-400">
                            {label}
                          </p>
                          <p className="mt-2 font-semibold capitalize">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div>
                      <h4 className="mb-3 font-semibold">
                        Rule observations
                      </h4>
                      {record.result.ruleReport.observations.length === 0 ? (
                        <p className="text-sm text-slate-400">
                          No deterministic rule findings.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {record.result.ruleReport.observations.map(
                            (finding, index) => (
                              <div
                                key={`${finding.ruleId}-${index}`}
                                className="rounded-lg border border-white/10 bg-[#0b1425] p-4"
                              >
                                <p className="font-semibold text-amber-300">
                                  {finding.ruleId}
                                  {' · '}
                                  <span className="capitalize">
                                    {finding.category}
                                  </span>
                                </p>
                                <p className="mt-3 text-sm leading-6 text-slate-300">
                                  {finding.observation}
                                </p>
                                <p className="mt-3 break-all font-mono text-xs leading-6 text-blue-300">
                                  {finding.evidenceNodeIds.join(', ') ||
                                    'No evidence span IDs'}
                                </p>
                              </div>
                            ),
                          )}
                        </div>
                      )}
                    </div>

                    <div>
                      <h4 className="mb-3 font-semibold">
                        Attribution hypotheses
                      </h4>

                      {record.result.ruleReport.hypotheses.length === 0 ? (
                        <p className="text-sm text-slate-400">
                          No attribution hypotheses recorded.
                        </p>
                      ) : (
                        record.result.ruleReport.hypotheses.map(
                          (hypothesis) => (
                            <div
                              key={hypothesis.category}
                              className="mb-3 rounded-lg border border-white/10 bg-[#0b1425] p-4"
                            >
                              <p className="font-semibold capitalize">
                                {hypothesis.category}
                                {' · '}
                                <span className="text-amber-300">
                                  {hypothesis.status}
                                </span>
                              </p>
                              <p className="mt-3 text-sm leading-6 text-slate-300">
                                {hypothesis.summary}
                              </p>
                              <div className="mt-3 space-y-1">
                                {hypothesis.limitations.map(
                                  (limitation) => (
                                    <p
                                      key={limitation}
                                      className="flex items-start gap-2 text-xs leading-5 text-slate-400"
                                    >
                                      <AlertTriangle
                                        size={13}
                                        className="mt-1 shrink-0 text-amber-400"
                                      />
                                      {limitation}
                                    </p>
                                  ),
                                )}
                              </div>
                            </div>
                          ),
                        )
                      )}
                    </div>

                    <div className="break-all border-t border-white/10 pt-4 font-mono text-xs leading-6 text-slate-500">
                      Trace ID: {record.traceId}
                      <p>
                        Fingerprint:{' '}
                        {record.traceFingerprint ?? 'Not stored (legacy record)'}
                      </p>
                      <p>Schema: {record.schemaVersion}</p>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}
