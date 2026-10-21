import { useState } from 'react'
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Database,
  FileJson,
  GitBranch,
  LayoutDashboard,
  SearchCheck,
  ShieldCheck,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import TraceExplorer from './components/traces/TraceExplorer'
import FailureAnalysis from './components/attribution/FailureAnalysis'
import EvidenceAttribution from './components/attribution/EvidenceAttribution'
import OptimizationSignals from './components/optimization/OptimizationSignals'
import EvaluationResults from './components/evaluation/EvaluationResults'


type Scenario = {
  id: string
  title: string
  description: string
  category: string | null
  rule: string | null
  explanation: string
}

const scenarios: Scenario[] = [
  {
    id: 'workflow-001',
    title: 'Required verification skipped',
    description: 'A patch succeeded, but mandatory tests were skipped.',
    category: 'workflow',
    rule: 'WORKFLOW-01',
    explanation:
      'HEAE identifies missing mandatory verification after a successful patch.',
  },
  {
    id: 'workflow-002',
    title: 'Optional verification',
    description: 'Tests were not required for this execution.',
    category: null,
    rule: null,
    explanation:
      'HEAE correctly avoids classifying optional verification as a workflow failure.',
  },
  {
    id: 'workflow-003',
    title: 'Environment interruption',
    description: 'Execution stopped before verification could begin.',
    category: null,
    rule: null,
    explanation:
      'HEAE accounts for the documented interruption instead of blaming the workflow.',
  },
  {
    id: 'workflow-004',
    title: 'Patch tool failure',
    description: 'The apply_patch operation failed.',
    category: 'tool',
    rule: 'TOOL-02',
    explanation:
      'HEAE detects the failed tool operation and attributes it to the tool category.',
  },
  {
    id: 'workflow-005',
    title: 'Test assertion failure',
    description: 'Tests ran, but an assertion failed.',
    category: null,
    rule: null,
    explanation:
      'HEAE does not automatically interpret a completed test run with failed assertions as a tool malfunction.',
  },
]

const navigation = [
  { name: 'Overview', icon: LayoutDashboard },
  { name: 'Trace Explorer', icon: GitBranch },
  { name: 'Failure Analysis', icon: SearchCheck },
  { name: 'Evidence & Attribution', icon: ShieldCheck },
  { name: 'Optimization Signals', icon: Zap },
  { name: 'Evaluation Results', icon: Activity },
]

const stages = [
  { name: 'Trace Intake', icon: FileJson },
  { name: 'Trace Graph', icon: GitBranch },
  { name: 'Rule Evaluation', icon: SearchCheck },
  { name: 'Attribution', icon: BrainCircuit },
  { name: 'Event Publishing', icon: Database },
]

function App() {
  const [selectedId, setSelectedId] = useState(scenarios[0].id)
  const [activePage, setActivePage] = useState('Overview')
  const [focusedSpanId, setFocusedSpanId] = useState<string | null>(null)

  const openTraceExplorer = (caseId: string, spanId?: string) => {
    setSelectedId(caseId)
    setFocusedSpanId(spanId ?? null)
    setActivePage('Trace Explorer')
  }

  const selected =
    scenarios.find((scenario) => scenario.id === selectedId) ??
    scenarios[0]

  return (
    <div className="min-h-screen bg-[#080e1c] text-slate-100">
      <div className="flex min-h-screen">
        <aside className="hidden w-65 shrink-0 border-r border-white/10 bg-[#0d1526] px-4 py-6 lg:block">
          <div className="mb-10 flex items-center gap-3 px-2">
            <div className="rounded-xl bg-blue-600 p-2.5">
              <BrainCircuit size={24} />
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight">HEAE</p>
              <p className="text-xs text-slate-400">Intelligence Console</p>
            </div>
          </div>

          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
            Navigation
          </p>

          <nav className="space-y-1">
            {navigation.map(({ name, icon: Icon }) => (
              <button
                key={name}
                onClick={() => setActivePage(name)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${
                  activePage === name
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon size={18} />
                {name}
              </button>
            ))}
          </nav>

          <div className="mt-12 rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-semibold">Development Demonstration</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Recorded synthetic scenarios. This console is not connected to a
              live Execution Core.
            </p>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex items-center justify-between border-b border-white/10 px-5 py-5 md:px-8">
            <div>
              <h1 className="text-lg font-semibold md:text-xl">
                {activePage}
              </h1>
              <p className="text-xs text-slate-400">
                Hierarchical Evaluation & Attribution Engine
              </p>
            </div>

            <div className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-300">
              Synthetic Development Demo
            </div>
          </header>

          <nav aria-label="Mobile navigation" className="flex gap-2 overflow-x-auto border-b border-white/10 px-5 py-3 lg:hidden">
            {navigation.map(({ name }) => (
              <button
                key={name}
                onClick={() => setActivePage(name)}
                className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium ${
                  activePage === name
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'bg-white/5 text-slate-400'
                }`}
              >
                {name}
              </button>
            ))}
          </nav>

          <div className="mx-auto max-w-7xl space-y-7 p-5 md:p-8">
            {activePage === 'Trace Explorer' ? (
              <TraceExplorer
                caseId={selectedId}
                onCaseChange={(caseId) => {
                  setSelectedId(caseId)
                  setFocusedSpanId(null)
                }}
                focusedSpanId={focusedSpanId}
              />
            ) : activePage === 'Failure Analysis' ? (
              <FailureAnalysis
                caseId={selectedId}
                onCaseChange={setSelectedId}
                onOpenTraceExplorer={openTraceExplorer}
              />
            ) : activePage === 'Evidence & Attribution' ? (
              <EvidenceAttribution
                caseId={selectedId}
                onCaseChange={setSelectedId}
                onOpenTraceExplorer={openTraceExplorer}
              />
            ) : activePage === 'Optimization Signals' ? (
              <OptimizationSignals
                caseId={selectedId}
                onCaseChange={setSelectedId}
                onOpenTraceExplorer={openTraceExplorer}
              />
            ) : activePage === 'Evaluation Results' ? (
              <EvaluationResults
                onOpenTraceExplorer={openTraceExplorer}
              />
            ) : activePage === 'Overview' ? (
              <>
                <section>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-400">
                <Activity size={16} />
                HEAE System Overview
              </div>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                Understand how an AI agent fails.
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
                HEAE analyses execution traces, detects failure patterns,
                builds evidence-supported attribution hypotheses, and prepares
                structured events for downstream system components.
              </p>
            </section>

            <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[
                { value: '5', label: 'Failure Categories', note: 'Supported classification types' },
                { value: '252', label: 'Tests Passed', note: 'Verified HEAE regression suite' },
                { value: '10', label: 'Synthetic Scenarios', note: 'Across two development datasets' },
                { value: '5/5', label: 'Contrast Matches', note: 'Development diagnostic only' },
              ].map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-2xl border border-white/10 bg-[#111b2f] p-5"
                >
                  <p className="text-3xl font-bold text-white">{metric.value}</p>
                  <p className="mt-3 text-sm font-semibold">{metric.label}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {metric.note}
                  </p>
                </div>
              ))}
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#111b2f] p-5 md:p-6">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Processing Pipeline</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    From execution trace to downstream evidence and signals
                  </p>
                </div>
                <span className="text-xs text-slate-500">Architecture view</span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {stages.map(({ name, icon: Icon }, index) => (
                  <div key={name} className="flex items-center gap-3">
                    <div className="flex min-w-32 flex-col items-center gap-3 rounded-xl border border-blue-400/15 bg-[#17243d] px-4 py-5">
                      <Icon size={24} className="text-blue-400" />
                      <span className="text-center text-xs font-medium">
                        {name}
                      </span>
                    </div>
                    {index < stages.length - 1 && (
                      <ChevronRight size={18} className="text-slate-500" />
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-5 text-xs text-slate-500">
                The pipeline diagram shows implemented HEAE capabilities;
                live downstream consumption is not yet demonstrated.
              </p>
            </section>

            <section className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">
              <div className="rounded-2xl border border-white/10 bg-[#111b2f] p-5 md:p-6">
                <h3 className="text-lg font-semibold">Scenario Explorer</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Select a recorded workflow-contrast scenario.
                </p>

                <div className="mt-5 space-y-2">
                  {scenarios.map((scenario) => (
                    <button
                      key={scenario.id}
                      onClick={() => setSelectedId(scenario.id)}
                      className={`flex w-full items-center justify-between rounded-xl border p-4 text-left transition ${
                        selectedId === scenario.id
                          ? 'border-blue-500 bg-blue-500/10'
                          : 'border-white/10 bg-white/3 hover:bg-white/5'
                      }`}
                    >
                      <div>
                        <p className="text-sm font-semibold">
                          {scenario.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {scenario.id}
                        </p>
                      </div>
                      <ArrowRight size={17} className="text-slate-400" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#111b2f] p-5 md:p-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">HEAE Classification</h3>
                  <span className="rounded-full bg-slate-700 px-3 py-1 text-xs">
                    Recorded result
                  </span>
                </div>

                <div className="mt-6 rounded-xl border border-white/10 bg-[#0b1425] p-5">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Selected case
                  </p>
                  <h4 className="mt-2 text-xl font-semibold">
                    {selected.title}
                  </h4>
                  <p className="mt-2 text-sm text-slate-400">
                    {selected.description}
                  </p>

                  <div className="mt-6 border-t border-white/10 pt-5">
                    {selected.category ? (
                      <div className="flex items-center gap-3">
                        <TriangleAlert className="text-amber-400" size={22} />
                        <div>
                          <p className="text-sm font-semibold capitalize text-amber-300">
                            {selected.category} failure detected
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            Rule: {selected.rule}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="text-emerald-400" size={22} />
                        <div>
                          <p className="text-sm font-semibold text-emerald-300">
                            No failure category assigned
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            No matching rule finding
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-5 rounded-xl border border-blue-400/15 bg-blue-400/5 p-5">
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-300">
                    <BrainCircuit size={17} />
                    Explanation
                  </p>
                  <p className="text-sm leading-7 text-slate-300">
                    {selected.explanation}
                  </p>
                </div>

                <p className="mt-5 text-xs leading-6 text-slate-500">
                  These classifications reproduce previously verified
                  development-diagnostic results. They are not live predictions,
                  independently measured accuracy, or proof of root cause.
                </p>
              </div>
            </section>

                <footer className="border-t border-white/10 pt-5 text-xs text-slate-500">
                  HEAE Intelligence Console · Software Engineering Research Demonstration
                </footer>
              </>
            ) : (
              <div className="rounded-xl border border-blue-400/20 bg-blue-400/10 p-5 text-sm text-blue-200">
                <p className="font-semibold">{activePage} is not implemented yet.</p>
                <p className="mt-2 text-slate-300">
                  This section is planned for a later development phase. The Overview,
                  Trace Explorer and Failure Analysis pages are currently available.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

export default App