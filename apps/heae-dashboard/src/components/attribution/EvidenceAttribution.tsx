
import { useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  FileSearch,
  GitBranch,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'

type Finding = {
  ruleId: string
  category: string
  observation: string
  evidenceNodeIds: string[]
  details?: Record<string, unknown>
}

type Hypothesis = {
  category: string
  status: string
  summary: string
  supportingRuleIds: string[]
  evidenceNodeIds: string[]
  limitations: string[]
}

type Snapshot = {
  caseId: string
  datasetProvenance: string
  evaluationMode: string
  traceSha256: string
  summary: {
    traceId: string
    outcome: string
    categories: string[]
    observationCount: number
    hypothesisCount: number
    judgeStatus: string
    warnings: string[]
  }
  attribution: {
    ruleReport: {
      observations: Finding[]
      hypotheses: Hypothesis[]
      requiresJudge: boolean
      warnings: string[]
    }
    judgeStatus: string
    judgment: unknown | null
    warnings: string[]
  }
}

type Props = {
  caseId: string
  onCaseChange: (caseId: string) => void
  onOpenTraceExplorer: (caseId: string, spanId?: string) => void
}

const cases = [
  { id: 'workflow-001', name: 'Mandatory verification skipped' },
  { id: 'workflow-002', name: 'Optional verification' },
  { id: 'workflow-003', name: 'Environment interruption' },
  { id: 'workflow-004', name: 'Patch tool failure' },
  { id: 'workflow-005', name: 'Test assertion failure' },
]

function EvidenceSpans({
  ids,
  caseId,
  onOpenTraceExplorer,
}: {
  ids: string[]
  caseId: string
  onOpenTraceExplorer: Props['onOpenTraceExplorer']
}) {
  const uniqueIds = [...new Set(ids)]

  if (uniqueIds.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No evidence span IDs recorded.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {uniqueIds.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onOpenTraceExplorer(caseId, id)}
          title={`Open trace span ${id}`}
          className="flex items-center gap-2 rounded-lg border border-blue-400/25 bg-blue-400/10 px-3 py-2 text-xs text-blue-300 transition hover:border-blue-400 hover:bg-blue-400/20"
        >
          <GitBranch size={13} />
          <code>{id}</code>
          <ArrowRight size={13} />
        </button>
      ))}
    </div>
  )
}

export default function EvidenceAttribution({
  caseId,
  onCaseChange,
  onOpenTraceExplorer,
}: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadSnapshot() {
      setLoading(true)
      setError(null)
      setSnapshot(null)

      try {
        const url =
          `${import.meta.env.BASE_URL}demo-evaluations/${caseId}.json`

        const response = await fetch(url, {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(
            `Could not load evaluation snapshot: ${caseId}`,
          )
        }

        const result = (await response.json()) as Snapshot

        if (
          result.caseId !== caseId ||
          !result.attribution?.ruleReport
        ) {
          throw new Error(
            'Evaluation snapshot format or case ID mismatch.',
          )
        }

        if (!controller.signal.aborted) {
          setSnapshot(result)
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unknown loading error',
          )
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadSnapshot()

    return () => controller.abort()
  }, [caseId])

  const findings =
    snapshot?.attribution.ruleReport.observations ?? []

  const hypotheses =
    snapshot?.attribution.ruleReport.hypotheses ?? []

  const warnings =
    snapshot?.attribution.warnings ?? []

  const judgeStatus = snapshot?.attribution.judgeStatus

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm text-blue-400">
          <ShieldCheck size={18} />
          HEAE Evidence Evaluation
        </div>

        <h2 className="text-2xl font-bold md:text-3xl">
          Evidence & Attribution
        </h2>

        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
          Explore how deterministic rule observations support
          attribution hypotheses and how evidence is connected
          to the original execution trace.
        </p>
      </header>

      <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm leading-6 text-amber-200">
        Synthetic development evaluation. These reports contain
        rule-based observations and unverified attribution hypotheses.
        The LLM judge was not configured for these snapshots.
      </div>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#111b2f] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="evidence-case" className="text-sm font-medium">
            Evaluation case
          </label>

          <select
            id="evidence-case"
            value={caseId}
            onChange={(event) =>
              onCaseChange(event.target.value)
            }
            className="max-w-full rounded-lg border border-white/15 bg-[#17243d] px-3 py-2 text-sm text-white"
          >
            {cases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} — {item.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => onOpenTraceExplorer(caseId)}
          className="flex items-center gap-2 rounded-lg border border-blue-400/25 bg-blue-400/10 px-4 py-2 text-sm text-blue-300 transition hover:bg-blue-400/20"
        >
          <GitBranch size={16} />
          Open full trace
          <ArrowRight size={16} />
        </button>
      </section>

      {loading && (
        <p className="text-sm text-slate-400">
          Loading attribution report...
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

      {snapshot && !loading && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: 'Recorded outcome',
                value: snapshot.summary.outcome,
                icon: Activity,
              },
              {
                label: 'Rule findings',
                value: String(findings.length),
                icon: FileSearch,
              },
              {
                label: 'Hypotheses',
                value: String(hypotheses.length),
                icon: BrainCircuit,
              },
              {
                label: 'Judge status',
                value: judgeStatus ?? 'Unknown',
                icon: ShieldCheck,
              },
            ].map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="rounded-xl border border-white/10 bg-[#111b2f] p-5"
              >
                <Icon size={20} className="text-blue-400" />
                <p className="mt-4 text-xs text-slate-400">
                  {label}
                </p>
                <p className="mt-2 break-words text-xl font-bold capitalize">
                  {value}
                </p>
              </div>
            ))}
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111b2f] p-5 md:p-6">
            <div className="mb-5 flex items-center gap-2">
              <FileSearch size={20} className="text-blue-400" />
              <h3 className="text-lg font-semibold">
                Deterministic rule observations
              </h3>
            </div>

            {findings.length === 0 ? (
              <div className="flex gap-3 rounded-xl border border-white/10 bg-[#0b1425] p-5">
                <CheckCircle2
                  size={21}
                  className="shrink-0 text-slate-400"
                />
                <div>
                  <p className="font-semibold">
                    No matching deterministic rule
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    HEAE did not identify a rule-supported failure
                    category for this trace. The recorded task outcome
                    is {snapshot.summary.outcome}. No finding does
                    not imply that the task succeeded.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {findings.map((finding, index) => (
                  <article
                    key={`${finding.ruleId}-${index}`}
                    className="rounded-xl border border-amber-400/20 bg-[#0b1425] p-5"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <ShieldAlert
                        size={20}
                        className="text-amber-400"
                      />
                      <strong className="text-amber-300">
                        {finding.ruleId}
                      </strong>
                      <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs capitalize text-amber-200">
                        {finding.category}
                      </span>
                    </div>

                    <p className="mt-4 text-sm leading-7 text-slate-200">
                      {finding.observation}
                    </p>

                    <div className="mt-5">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Rule evidence
                      </p>
                      <EvidenceSpans
                        ids={finding.evidenceNodeIds}
                        caseId={caseId}
                        onOpenTraceExplorer={onOpenTraceExplorer}
                      />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111b2f] p-5 md:p-6">
            <div className="mb-5 flex items-center gap-2">
              <BrainCircuit size={20} className="text-blue-400" />
              <h3 className="text-lg font-semibold">
                Attribution hypotheses
              </h3>
            </div>

            {hypotheses.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#0b1425] p-5">
                <p className="text-sm font-semibold">
                  No rule-supported hypothesis generated
                </p>
                <p className="mt-2 text-sm leading-7 text-slate-400">
                  This unsuccessful execution may still require
                  further investigation. The absence of a hypothesis
                  does not establish the absence of an underlying cause.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {hypotheses.map((hypothesis) => {
                  const supportingFindings = findings.filter(
                    (finding) =>
                      hypothesis.supportingRuleIds.includes(
                        finding.ruleId,
                      ),
                  )

                  return (
                    <article
                      key={hypothesis.category}
                      className="rounded-xl border border-white/10 bg-[#0b1425] p-5"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <BrainCircuit
                          size={19}
                          className="text-blue-400"
                        />
                        <h4 className="font-semibold capitalize">
                          {hypothesis.category} hypothesis
                        </h4>
                        <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs capitalize text-amber-300">
                          {hypothesis.status}
                        </span>
                      </div>

                      <p className="mt-4 text-sm leading-7 text-slate-300">
                        {hypothesis.summary}
                      </p>

                      <div className="mt-5 grid gap-4 lg:grid-cols-2">
                        <div className="rounded-lg border border-white/10 p-4">
                          <p className="mb-3 text-xs font-semibold uppercase text-slate-400">
                            Supporting rules
                          </p>

                          <div className="flex flex-wrap gap-2">
                            {hypothesis.supportingRuleIds.map((id) => (
                              <span
                                key={id}
                                className="rounded bg-blue-400/10 px-3 py-2 font-mono text-xs text-blue-300"
                              >
                                {id}
                              </span>
                            ))}
                          </div>

                          <p className="mt-3 text-xs text-slate-500">
                            {supportingFindings.length} recorded rule
                            observation(s) matched this hypothesis.
                          </p>
                        </div>

                        <div className="rounded-lg border border-white/10 p-4">
                          <p className="mb-3 text-xs font-semibold uppercase text-slate-400">
                            Supporting spans
                          </p>

                          <EvidenceSpans
                            ids={hypothesis.evidenceNodeIds}
                            caseId={caseId}
                            onOpenTraceExplorer={onOpenTraceExplorer}
                          />
                        </div>
                      </div>

                      <div className="mt-5 rounded-lg border border-amber-400/15 bg-amber-400/5 p-4">
                        <p className="mb-3 text-sm font-semibold text-amber-300">
                          Attribution limitations
                        </p>

                        {hypothesis.limitations.map((limitation) => (
                          <p
                            key={limitation}
                            className="mt-2 flex items-start gap-2 text-xs leading-6 text-slate-300"
                          >
                            <AlertTriangle
                              size={14}
                              className="mt-1 shrink-0 text-amber-400"
                            />
                            {limitation}
                          </p>
                        ))}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111b2f] p-5 md:p-6">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck
                size={20}
                className="text-blue-400"
              />
              <h3 className="text-lg font-semibold">
                LLM judge assessment
              </h3>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#0b1425] p-5">
              <p className="text-sm">
                Judge status:{' '}
                <strong className="capitalize text-amber-300">
                  {judgeStatus}
                </strong>
              </p>

              {snapshot.attribution.judgment === null ? (
                <p className="mt-3 text-sm leading-7 text-slate-400">
                  No LLM assessment is recorded for this evaluation.
                  The current hypothesis remains unverified. Do not
                  interpret rule observations as confirmed root causes.
                </p>
              ) : (
                <div className="mt-4">
                  <p className="mb-3 text-xs text-slate-400">
                    Recorded judge response
                  </p>

                  <pre className="max-h-80 overflow-auto rounded-lg bg-[#080e1c] p-4 text-xs text-slate-300">
                    {JSON.stringify(
                      snapshot.attribution.judgment,
                      null,
                      2,
                    )}
                  </pre>
                </div>
              )}
            </div>
          </section>

          {warnings.length > 0 && (
            <section className="rounded-xl border border-amber-400/15 bg-amber-400/5 p-5">
              <h3 className="mb-3 text-sm font-semibold text-amber-300">
                Evaluation warnings
              </h3>

              {warnings.map((warning, index) => (
                <p
                  key={index}
                  className="mt-2 flex gap-2 text-xs leading-6 text-slate-300"
                >
                  <AlertTriangle
                    size={14}
                    className="mt-1 shrink-0 text-amber-400"
                  />
                  {warning}
                </p>
              ))}
            </section>
          )}

          <footer className="break-all rounded-xl border border-white/10 p-4 text-xs leading-7 text-slate-500">
            <p>Trace ID: {snapshot.summary.traceId}</p>
            <p>Source SHA-256: {snapshot.traceSha256}</p>
            <p>Dataset provenance: {snapshot.datasetProvenance}</p>
            <p>Evaluation mode: {snapshot.evaluationMode}</p>
          </footer>
        </>
      )}
    </div>
  )
}
