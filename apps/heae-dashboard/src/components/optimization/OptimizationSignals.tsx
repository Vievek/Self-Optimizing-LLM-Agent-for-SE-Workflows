
import { useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  CircleHelp,
  CircleX,
  FileSearch,
  GitBranch,
  ShieldCheck,
  Zap,
} from 'lucide-react'

type Hypothesis = {
  category: string
  status: string
  supportingRuleIds: string[]
  evidenceNodeIds: string[]
}

type Snapshot = {
  caseId: string
  datasetProvenance: string
  evaluationMode: string
  summary: {
    traceId: string
    outcome: string
    categories: string[]
    judgeStatus: string
  }
  attribution: {
    judgeStatus: string
    judgment: unknown | null
    ruleReport: {
      hypotheses: Hypothesis[]
      observations: Array<{
        ruleId: string
        category: string
        evidenceNodeIds: string[]
      }>
    }
  }
}

type Props = {
  caseId: string
  onCaseChange: (caseId: string) => void
  onOpenTraceExplorer: (caseId: string, spanId?: string) => void
}

const cases = [
  { id: 'workflow-001', label: 'Mandatory verification skipped' },
  { id: 'workflow-002', label: 'Optional verification' },
  { id: 'workflow-003', label: 'Environment interruption' },
  { id: 'workflow-004', label: 'Patch tool failure' },
  { id: 'workflow-005', label: 'Test assertion failure' },
]

type RequirementStatus = 'met' | 'missing' | 'unknown'

function Requirement({
  label,
  description,
  status,
}: {
  label: string
  description: string
  status: RequirementStatus
}) {
  const Icon =
    status === 'met'
      ? CheckCircle2
      : status === 'missing'
        ? CircleX
        : CircleHelp

  const color =
    status === 'met'
      ? 'text-emerald-400'
      : status === 'missing'
        ? 'text-rose-400'
        : 'text-slate-400'

  return (
    <div className="flex gap-3 rounded-xl border border-white/10 bg-[#0b1425] p-4">
      <Icon size={21} className={`mt-0.5 shrink-0 ${color}`} />

      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-1 text-xs leading-6 text-slate-400">
          {description}
        </p>
        <p className={`mt-2 text-xs font-medium capitalize ${color}`}>
          {status === 'unknown' ? 'Not established' : status}
        </p>
      </div>
    </div>
  )
}

export default function OptimizationSignals({
  caseId,
  onCaseChange,
  onOpenTraceExplorer,
}: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)
      setSnapshot(null)

      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}demo-evaluations/${caseId}.json`,
          { signal: controller.signal },
        )

        if (!response.ok) {
          throw new Error('Evaluation snapshot could not be loaded.')
        }

        const result = (await response.json()) as Snapshot

        if (
          result.caseId !== caseId ||
          !result.attribution?.ruleReport
        ) {
          throw new Error('Invalid evaluation snapshot.')
        }

        if (!controller.signal.aborted) {
          setSnapshot(result)
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

    void load()

    return () => controller.abort()
  }, [caseId])

  const hypotheses =
    snapshot?.attribution.ruleReport.hypotheses ?? []

  const observations =
    snapshot?.attribution.ruleReport.observations ?? []

  const outcome = snapshot?.summary.outcome ?? 'unknown'

  const unsuccessful =
    outcome === 'fail' || outcome === 'error'

  const hasHypothesis = hypotheses.length > 0

  const judgeCompleted =
    snapshot?.attribution.judgeStatus === 'completed' &&
    snapshot.attribution.judgment !== null

  // The snapshot does not include a reviewed proposal or
  // externally inspected publication records.
  const requirements: Array<{
    label: string
    description: string
    status: RequirementStatus
  }> = [
    {
      label: 'Unsuccessful execution',
      description: `Recorded task outcome: ${outcome}`,
      status: unsuccessful
        ? 'met'
        : outcome === 'pass'
          ? 'missing'
          : 'unknown',
    },
    {
      label: 'Matching rule-based hypothesis',
      description: hasHypothesis
        ? `${hypotheses.length} candidate hypothesis/hypotheses recorded`
        : 'No deterministic attribution hypothesis was generated',
      status: hasHypothesis ? 'met' : 'missing',
    },
    {
      label: 'Completed LLM judgment',
      description: `Judge status: ${
        snapshot?.attribution.judgeStatus ?? 'unknown'
      }`,
      status: judgeCompleted ? 'met' : 'missing',
    },
    {
      label: 'Judge-supported category and evidence',
      description: judgeCompleted
        ? 'A completed judgment exists; matching support must be checked against a proposed signal.'
        : 'Cannot establish supporting judge findings without a completed judgment',
      status: 'unknown',
    },
    {
      label: 'Reviewed optimization proposal',
      description:
        'Review status, target configuration, proposed action and confidence are not included in this snapshot',
      status: 'unknown',
    },
    {
      label: 'Validated OptimizationSignal schema',
      description:
        'Validation is performed by the backend when a complete proposal is submitted',
      status: 'unknown',
    },
  ]

  const eligibleFromSnapshot = false

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm text-blue-400">
          <Zap size={18} />
          HEAE Optimization Pipeline
        </div>

        <h2 className="text-2xl font-bold md:text-3xl">
          Optimization Signals
        </h2>

        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
          Understand the prerequisites for generating evidence-supported
          optimization signals and how HEAE communicates eligible
          recommendations to downstream components.
        </p>
      </header>

      <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm leading-6 text-amber-200">
        This is a read-only eligibility explanation based on recorded
        synthetic evaluations. No signal-generation or publication
        command is executed by this page.
      </div>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#111b2f] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="signal-case" className="text-sm font-medium">
            Evaluation case
          </label>

          <select
            id="signal-case"
            value={caseId}
            onChange={(event) => onCaseChange(event.target.value)}
            className="max-w-full rounded-lg border border-white/15 bg-[#17243d] px-3 py-2 text-sm text-white"
          >
            {cases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} — {item.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => onOpenTraceExplorer(caseId)}
          className="flex items-center gap-2 rounded-lg border border-blue-400/25 bg-blue-400/10 px-4 py-2 text-sm text-blue-300"
        >
          <GitBranch size={16} />
          Inspect execution trace
          <ArrowRight size={16} />
        </button>
      </section>

      {loading && (
        <p className="text-sm text-slate-400">Loading evaluation...</p>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-rose-400/30 p-4 text-rose-300">
          {error}
        </div>
      )}

      {snapshot && !loading && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: 'Task outcome',
                value: outcome,
                icon: Activity,
              },
              {
                label: 'Rule observations',
                value: String(observations.length),
                icon: FileSearch,
              },
              {
                label: 'Hypotheses',
                value: String(hypotheses.length),
                icon: BrainCircuit,
              },
              {
                label: 'Judge status',
                value: snapshot.summary.judgeStatus,
                icon: ShieldCheck,
              },
            ].map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="rounded-xl border border-white/10 bg-[#111b2f] p-5"
              >
                <Icon size={20} className="text-blue-400" />
                <p className="mt-3 text-xs text-slate-400">{label}</p>
                <p className="mt-2 text-xl font-bold capitalize">
                  {value}
                </p>
              </div>
            ))}
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111b2f] p-5 md:p-6">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck size={20} className="text-blue-400" />
              <h3 className="text-lg font-semibold">
                Signal generation requirements
              </h3>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {requirements.map((requirement) => (
                <Requirement
                  key={requirement.label}
                  {...requirement}
                />
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111b2f] p-5 md:p-6">
            <div className="flex items-start gap-3">
              {eligibleFromSnapshot ? (
                <CheckCircle2 size={24} className="text-emerald-400" />
              ) : (
                <AlertTriangle
                  size={24}
                  className="shrink-0 text-amber-400"
                />
              )}

              <div>
                <h3 className="text-lg font-semibold">
                  Signal generation assessment
                </h3>

                <p className="mt-3 text-sm leading-7 text-slate-300">
                  {snapshot.attribution.judgeStatus !== 'completed'
                    ? 'Signal generation is blocked for this rule-only evaluation because no completed LLM judgment is recorded.'
                    : 'This evaluation cannot establish signal eligibility without a reviewed proposal and confirmation of supporting judgment evidence.'}
                </p>

                <p className="mt-3 text-xs leading-6 text-slate-400">
                  This assessment explains prerequisite availability.
                  It is not an actual result returned by
                  generateOptimizationSignal().
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111b2f] p-5 md:p-6">
            <h3 className="mb-4 text-lg font-semibold">
              Downstream publication status
            </h3>

            <div className="rounded-xl border border-white/10 bg-[#0b1425] p-4">
              <div className="flex items-center gap-2 text-slate-300">
                <CircleHelp size={19} />
                <strong className="text-sm">Not checked</strong>
              </div>

              <p className="mt-3 text-sm leading-7 text-slate-400">
                This evaluation snapshot does not include publication
                records. No claim is made that a signal was published,
                skipped by a publication command, or consumed by the
                Optimization Orchestrator.
              </p>

              <p className="mt-3 font-mono text-xs text-blue-300">
                store/events/optimization_signals.jsonl
              </p>
            </div>
          </section>

          <footer className="break-all rounded-xl border border-white/10 p-4 text-xs leading-6 text-slate-500">
            <p>Trace ID: {snapshot.summary.traceId}</p>
            <p>Dataset: {snapshot.datasetProvenance}</p>
            <p>Evaluation mode: {snapshot.evaluationMode}</p>
          </footer>
        </>
      )}
    </div>
  )
}
