
import { useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  AlertTriangle,
  CheckCircle2,
  FileJson,
  GitBranch,
  Info,
} from 'lucide-react'

type Span = {
  span_id: string
  trace_id: string
  parent_span_id: string | null
  name: string
  start_ts: string
  end_ts: string
  status: string
  attributes: Record<string, unknown>
  links: Array<{ span_id: string; rel: string }>
}

type Annotation = {
  caseId: string
  expectedCategories: string[]
  observedOutcome: string
  annotationStatus: string
  datasetProvenance: string
  categoryEvidence: Array<{
    category: string
    spanIds: string[]
    justification: string
  }>
  limitations: string[]
}

type AnnotationFile = {
  annotations: Annotation[]
}

type SpanNodeData = {
  label: string
  status: string
  spanId: string
  annotated: boolean
}

type SpanFlowNode = Node<SpanNodeData, 'span'>

type TraceExplorerProps = {
  caseId: string
  onCaseChange: (caseId: string) => void
  focusedSpanId: string | null
}

const cases = [
  { id: 'workflow-001', name: 'Mandatory tests skipped' },
  { id: 'workflow-002', name: 'Optional verification' },
  { id: 'workflow-003', name: 'Environment interruption' },
  { id: 'workflow-004', name: 'Patch tool failure' },
  { id: 'workflow-005', name: 'Test assertion failure' },
]

function SpanCard({ data, selected }: NodeProps<SpanFlowNode>) {
  const failed = data.status === 'error'

  return (
    <div
      className={`w-55 rounded-xl border bg-[#17243d] p-3 text-slate-100 shadow-lg transition-colors ${
        selected
          ? 'border-blue-400 ring-2 ring-blue-400/40'
          : data.annotated
            ? 'border-amber-400'
            : 'border-slate-600'
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-blue-400"
      />

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase text-blue-300">
          {data.label}
        </span>

        {failed ? (
          <AlertTriangle size={16} className="shrink-0 text-rose-400" />
        ) : (
          <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
        )}
      </div>

      <p className="mt-2 break-all font-mono text-[10px] text-slate-400">
        {data.spanId}
      </p>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-300">
          {data.status}
        </span>

        {data.annotated && (
          <span className="rounded bg-amber-400/15 px-2 py-1 text-[10px] text-amber-300">
            Annotated
          </span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-blue-400"
      />
    </div>
  )
}

const nodeTypes = {
  span: SpanCard,
}

function buildGraph(
  spans: Span[],
  evidenceIds: Set<string>,
): { nodes: SpanFlowNode[]; edges: Edge[] } {
  const byId = new Map(
    spans.map((span) => [span.span_id, span]),
  )

  const depths = new Map<string, number>()
  const visiting = new Set<string>()

  function depth(span: Span): number {
    const cached = depths.get(span.span_id)

    if (cached !== undefined) {
      return cached
    }

    if (visiting.has(span.span_id)) {
      return 0
    }

    visiting.add(span.span_id)

    const parent = span.parent_span_id
      ? byId.get(span.parent_span_id)
      : undefined

    const value = parent ? depth(parent) + 1 : 0

    visiting.delete(span.span_id)
    depths.set(span.span_id, value)

    return value
  }

  const groups = new Map<number, Span[]>()

  for (const span of spans) {
    const level = depth(span)

    groups.set(level, [
      ...(groups.get(level) ?? []),
      span,
    ])
  }

  const nodes: SpanFlowNode[] = []

  for (const [level, group] of groups) {
    group.forEach((span, index) => {
      nodes.push({
        id: span.span_id,
        type: 'span',
        position: {
          x: index * 275,
          y: level * 165,
        },
        data: {
          label:
            span.name === 'tool_call'
              ? `tool: ${String(
                  span.attributes.tool_name ?? 'unknown',
                )}`
              : span.name,
          status: span.status,
          spanId: span.span_id,
          annotated: evidenceIds.has(span.span_id),
        },
      })
    })
  }

  const edges: Edge[] = []
  const seen = new Set<string>()

  function addEdge(
    source: string,
    target: string,
    relation: 'PARENT_OF' | 'CAUSED_BY',
  ) {
    if (!byId.has(source) || !byId.has(target)) {
      return
    }

    const id = `${relation}:${source}:${target}`

    if (seen.has(id)) {
      return
    }

    seen.add(id)

    edges.push({
      id,
      source,
      target,
      type: 'smoothstep',
      label:
        relation === 'CAUSED_BY'
          ? 'caused by'
          : undefined,
      style: {
        stroke:
          relation === 'CAUSED_BY'
            ? '#f59e0b'
            : '#64748b',
        strokeWidth:
          relation === 'CAUSED_BY'
            ? 2
            : 1.5,
        strokeDasharray:
          relation === 'CAUSED_BY'
            ? '5 4'
            : undefined,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color:
          relation === 'CAUSED_BY'
            ? '#f59e0b'
            : '#64748b',
      },
    })
  }

  for (const span of spans) {
    if (span.parent_span_id) {
      addEdge(
        span.parent_span_id,
        span.span_id,
        'PARENT_OF',
      )
    }

    for (const link of span.links ?? []) {
      if (link.rel === 'caused_by') {
        // Matches the HEAE backend graph direction.
        addEdge(
          span.span_id,
          link.span_id,
          'CAUSED_BY',
        )
      }
    }
  }

  return {
    nodes,
    edges,
  }
}

/**
 * Automatically focus the graph on the evidence span
 * requested from the Failure Analysis page.
 *
 * This component must be rendered inside ReactFlow.
 */
function FocusEvidenceNode({
  spanId,
  available,
}: {
  spanId: string | null
  available: boolean
}) {
  const { fitView } = useReactFlow()

  useEffect(() => {
    if (!spanId || !available) {
      return
    }

    const frame = requestAnimationFrame(() => {
      void fitView({
        nodes: [{ id: spanId }],
        duration: 350,
        padding: 0.7,
        maxZoom: 1.25,
      })
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [spanId, available, fitView])

  return null
}

export default function TraceExplorer({
  caseId,
  onCaseChange,
  focusedSpanId,
}: TraceExplorerProps) {
  const [spans, setSpans] = useState<Span[]>([])
  const [annotation, setAnnotation] = useState<Annotation | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      setSpans([])
      setAnnotation(null)
      setSelectedId(null)

      try {
        const base = import.meta.env.BASE_URL

        const [
          traceResponse,
          annotationResponse,
        ] = await Promise.all([
          fetch(`${base}demo-traces/${caseId}.jsonl`),
          fetch(`${base}demo-traces/annotations.json`),
        ])

        if (
          !traceResponse.ok ||
          !annotationResponse.ok
        ) {
          throw new Error(
            'Could not load the recorded trace files.',
          )
        }

        const traceText = await traceResponse.text()

        const annotations =
          (await annotationResponse.json()) as AnnotationFile

        const parsed = traceText
          .split(/\r?\n/)
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as Span)

        const matched =
          annotations.annotations.find(
            (item) => item.caseId === caseId,
          ) ?? null

        if (parsed.length === 0 || !matched) {
          throw new Error(
            'Trace spans or annotation not found.',
          )
        }

        const requestedSpanExists =
          focusedSpanId !== null &&
          parsed.some(
            (span) => span.span_id === focusedSpanId,
          )

        if (!cancelled) {
          setSpans(parsed)
          setAnnotation(matched)

          setSelectedId(
            requestedSpanExists
              ? focusedSpanId
              : parsed[0].span_id,
          )
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unknown loading error',
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [caseId, focusedSpanId])

  const evidenceIds = useMemo(
    () =>
      new Set(
        annotation?.categoryEvidence.flatMap(
          (entry) => entry.spanIds,
        ) ?? [],
      ),
    [annotation],
  )

  const { nodes, edges } = useMemo(() => {
    const graph = buildGraph(spans, evidenceIds)

    return {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        selected: node.id === selectedId,
      })),
    }
  }, [spans, evidenceIds, selectedId])

  const selectedSpan = spans.find(
    (span) => span.span_id === selectedId,
  )

  const selectedEvidence =
    annotation?.categoryEvidence.filter(
      (entry) =>
        entry.spanIds.includes(selectedId ?? ''),
    ) ?? []

  const focusAvailable =
    focusedSpanId !== null &&
    nodes.some((node) => node.id === focusedSpanId)

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold">
          Interactive Trace Explorer
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          Examine recorded JSONL spans and their
          relationships. Select a graph node to inspect
          its original execution attributes.
        </p>
      </div>

      <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200">
        Synthetic development data · Draft annotations ·
        Not a live Execution Core run or independently
        validated attribution.
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-[#111b2f] p-4">
        <label
          htmlFor="trace-case"
          className="text-sm font-medium"
        >
          Recorded scenario
        </label>

        <select
          id="trace-case"
          value={caseId}
          onChange={(event) =>
            onCaseChange(event.target.value)
          }
          className="min-w-65 rounded-lg border border-white/15 bg-[#17243d] px-3 py-2 text-sm text-white"
        >
          {cases.map((item) => (
            <option
              key={item.id}
              value={item.id}
            >
              {item.id} — {item.name}
            </option>
          ))}
        </select>

        {annotation && (
          <span className="text-xs text-slate-400">
            Recorded outcome:{' '}
            {annotation.observedOutcome}
            {' · '}
            {spans.length} spans
          </span>
        )}
      </div>

      {loading && (
        <p className="text-sm text-slate-400">
          Loading trace...
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 p-4 text-rose-300"
        >
          {error}
        </div>
      )}

      {!loading && !error && annotation && (
        <>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-[#111b2f]">
              <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
                <GitBranch
                  size={17}
                  className="text-blue-400"
                />

                <span className="text-sm font-semibold">
                  Trace relationships
                </span>

                <span className="text-xs text-slate-400">
                  Gray: parent-child · Amber dashed:
                  caused-by
                </span>
              </div>

              {focusedSpanId && focusAvailable && (
                <div className="border-b border-blue-400/15 bg-blue-400/5 px-4 py-2 text-xs text-blue-300">
                  Navigated to evidence span:{' '}
                  <code>{focusedSpanId}</code>
                </div>
              )}

              {focusedSpanId && !focusAvailable && (
                <div className="border-b border-amber-400/15 bg-amber-400/5 px-4 py-2 text-xs text-amber-300">
                  Requested evidence span not found in
                  this recorded trace.
                </div>
              )}

              <div className="h-125 bg-[#0b1425]">
                <ReactFlow
                  key={caseId}
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  onNodeClick={(_, node) => {
                    setSelectedId(node.id)
                  }}
                  fitView
                  fitViewOptions={{
                    padding: 0.25,
                  }}
                  nodesDraggable
                  nodesConnectable={false}
                  elementsSelectable
                  colorMode="dark"
                >
                  <Background
                    color="#263650"
                    gap={22}
                  />

                  <Controls />

                  <MiniMap
                    pannable
                    zoomable
                  />

                  <FocusEvidenceNode
                    spanId={focusedSpanId}
                    available={focusAvailable}
                  />
                </ReactFlow>
              </div>
            </div>

            <div className="min-w-0 rounded-xl border border-white/10 bg-[#111b2f] p-5">
              <div className="mb-4 flex items-center gap-2">
                <FileJson
                  size={18}
                  className="text-blue-400"
                />

                <h3 className="font-semibold">
                  Span details
                </h3>
              </div>

              {selectedSpan ? (
                <div className="space-y-4">
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="text-slate-400">
                        Name:
                      </span>{' '}
                      {selectedSpan.name}
                    </p>

                    <p>
                      <span className="text-slate-400">
                        Status:
                      </span>{' '}
                      {selectedSpan.status}
                    </p>

                    <p className="break-all">
                      <span className="text-slate-400">
                        Span ID:
                      </span>{' '}
                      {selectedSpan.span_id}
                    </p>

                    <p className="break-all">
                      <span className="text-slate-400">
                        Parent:
                      </span>{' '}
                      {selectedSpan.parent_span_id ?? 'None'}
                    </p>

                    <p className="break-all">
                      <span className="text-slate-400">
                        Trace ID:
                      </span>{' '}
                      {selectedSpan.trace_id}
                    </p>

                    <p>
                      <span className="text-slate-400">
                        Start:
                      </span>{' '}
                      {selectedSpan.start_ts}
                    </p>

                    <p>
                      <span className="text-slate-400">
                        End:
                      </span>{' '}
                      {selectedSpan.end_ts}
                    </p>
                  </div>

                  <div>
                    <h4 className="mb-2 text-sm font-semibold">
                      Original attributes
                    </h4>

                    <pre className="max-h-70 overflow-auto rounded-lg bg-[#080e1c] p-3 text-xs text-slate-300">
                      {JSON.stringify(
                        selectedSpan.attributes,
                        null,
                        2,
                      )}
                    </pre>
                  </div>

                  {selectedEvidence.length > 0 && (
                    <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
                      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
                        <Info size={16} />
                        Draft annotation evidence
                      </div>

                      {selectedEvidence.map((entry) => (
                        <div
                          key={entry.category}
                          className="mb-2 text-xs leading-6"
                        >
                          <strong className="capitalize">
                            {entry.category}
                          </strong>

                          <p className="text-slate-300">
                            {entry.justification}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedEvidence.length === 0 && (
                    <p className="text-xs text-slate-500">
                      This span is not referenced by the
                      draft category-evidence annotations.
                      It may still be referenced by an HEAE
                      rule observation.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-400">
                  Select a node to view its details.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#111b2f] p-5">
            <h3 className="mb-3 font-semibold">
              Recorded annotation summary
            </h3>

            <p className="text-sm">
              Expected categories:{' '}
              <span className="text-blue-300">
                {annotation.expectedCategories.join(', ') ||
                  'None assigned'}
              </span>
            </p>

            <p className="mt-2 text-xs text-slate-400">
              Annotation status:{' '}
              {annotation.annotationStatus}
              {' · '}
              Provenance:{' '}
              {annotation.datasetProvenance}
            </p>

            <div className="mt-4 space-y-2">
              {annotation.limitations.map(
                (limitation, index) => (
                  <p
                    key={index}
                    className="flex gap-2 text-xs leading-6 text-slate-400"
                  >
                    <AlertTriangle
                      size={14}
                      className="mt-1 shrink-0 text-amber-400"
                    />

                    {limitation}
                  </p>
                ),
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
