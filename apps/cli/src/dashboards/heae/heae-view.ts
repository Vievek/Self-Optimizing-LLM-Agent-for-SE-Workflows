import {
  generateOptimizationSignal,
  type StoredEvaluation,
  type TraceGraph,
} from '@soa/heae';
import type { OptimizationSignal } from '@soa/contracts';
import type { ReviewedOptimizationProposal } from '@soa/heae';
import type { DashboardView, TuiState, ViewAction } from '../types.js';
import {
  ANSI,
  getTheme,
  highlightRow,
  renderBadge,
  renderPanels,
  renderTopHeader,
  sectionLabel,
  sliceAnsi,
  spacer,
  toLines,
  vstack,
  type ThemeColors,
} from '../../theme/index.js';
import { renderControlBar } from '../../components/index.js';
import { HeaeDataSource, type HeaeDataReader } from './heae-data.js';

function outcomeBadge(
  outcome: StoredEvaluation['result']['ruleReport']['outcome'],
  theme: ThemeColors,
): string {
  const variant = outcome === 'pass' ? 'built' : outcome === 'unknown' ? 'info' : 'error';
  return renderBadge(outcome.toUpperCase(), variant, theme);
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

type GraphPresentation = 'visual' | 'list';
type GraphLayoutNode = {
  index: number;
  x: number;
  y: number;
  width: number;
};
type GraphLayout = {
  nodes: GraphLayoutNode[];
  width: number;
  height: number;
};

const GRAPH_NODE_WIDTH = 24;
const GRAPH_NODE_HEIGHT = 4;
const GRAPH_NODE_GAP = 4;
const GRAPH_ROW_GAP = 2;
const GRAPH_MAX_VISUAL_NODES = 16;
const GRAPH_MAX_VISUAL_EDGES = 48;

function graphLayers(graph: TraceGraph): number[] {
  const layers = graph.nodes.map(() => 0);
  const incoming = graph.nodes.map(() => 0);
  const outgoing = graph.nodes.map(() => [] as number[]);
  const indexById = new Map(graph.nodes.map((node, index) => [node.id, index]));
  for (const edge of graph.edges) {
    const source = indexById.get(edge.source);
    const target = indexById.get(edge.target);
    if (source === undefined || target === undefined) continue;
    outgoing[source]!.push(target);
    incoming[target]! += 1;
  }

  const queue = graph.nodes.map((_, index) => index).filter((index) => incoming[index] === 0);
  let processed = 0;
  while (queue.length > 0) {
    const source = queue.shift()!;
    processed += 1;
    for (const target of outgoing[source]!) {
      layers[target] = Math.max(layers[target]!, layers[source]! + 1);
      incoming[target] = incoming[target]! - 1;
      if (incoming[target] === 0) queue.push(target);
    }
  }

  // Cycles have no topological starting point. Keep their deterministic input
  // order and place them in the first layer rather than looping forever.
  if (processed < graph.nodes.length) {
    graph.nodes.forEach((_, index) => {
      if (incoming[index]! > 0) layers[index] = 0;
    });
  }
  return layers;
}

function layoutGraph(graph: TraceGraph): GraphLayout {
  const layers = graphLayers(graph);
  const maxLayer = Math.max(0, ...layers);
  const columns = Array.from({ length: maxLayer + 1 }, () => [] as number[]);
  layers.forEach((layer, index) => columns[layer]!.push(index));
  const nodes: GraphLayoutNode[] = [];
  columns.forEach((column, layer) => {
    column.forEach((index, row) => {
      nodes[index] = {
        index,
        x: layer * (GRAPH_NODE_WIDTH + GRAPH_NODE_GAP),
        y: row * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP),
        width: GRAPH_NODE_WIDTH,
      };
    });
  });
  return {
    nodes,
    width: Math.max(GRAPH_NODE_WIDTH, (maxLayer + 1) * (GRAPH_NODE_WIDTH + GRAPH_NODE_GAP) - GRAPH_NODE_GAP),
    height: Math.max(GRAPH_NODE_HEIGHT, ...columns.map((column) => column.length * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP) - GRAPH_ROW_GAP)),
  };
}

function graphVisualSupported(graph: TraceGraph, innerWidth: number): boolean {
  return innerWidth >= GRAPH_NODE_WIDTH + 8
    && graph.nodes.length > 0
    && graph.nodes.length <= GRAPH_MAX_VISUAL_NODES
    && graph.edges.length <= GRAPH_MAX_VISUAL_EDGES;
}

export class HeaeDashboardView implements DashboardView {
  id = 'heae';
  name = 'HEAE Evaluation';
  title = 'HEAE Evaluation · Hierarchical Attribution Engine';
  tabs = [
    'Overview',
    'Saved Evaluations',
    'Failure Analysis',
    'Evidence & Attribution',
    'Trace Graph',
    'Optimization Signals',
    'Evaluation Results',
  ];
  actionLabel = 'refresh';

  private readonly source: HeaeDataReader;
  private evaluations: StoredEvaluation[] = [];
  private loading = true;
  private error?: string;
  private refreshPromise: Promise<void>;
  private detailScrollOffset = 0;
  private lastRenderedTab?: number;
  private graph?: TraceGraph;
  private graphTraceId?: string;
  private graphLoading = false;
  private graphError?: string;
  private graphPromise: Promise<void> = Promise.resolve();
  private graphFocus: 'nodes' | 'edges' = 'nodes';
  private graphNodeIndex = 0;
  private graphEdgeIndex = 0;
  private graphPresentation: GraphPresentation = 'visual';
  private graphPanX = 0;
  private graphPanY = 0;
  private graphInspectorScrollOffset = 0;
  private graphPanelHeight = 0;
  private graphPanelWidth = 0;
  private graphVisualActive = false;
  private signals: OptimizationSignal[] = [];
  private signalTraceId?: string;
  private signalLoading = false;
  private signalError?: string;
  private signalPromise: Promise<void> = Promise.resolve();
  private signalRecordIndex = 0;
  private signalRecordHeight = 1;
  private resultsScrollOffset = 0;
  private resultsTraceId?: string;

  constructor(source: HeaeDataReader = new HeaeDataSource()) {
    this.source = source;
    this.refreshPromise = this.refresh();
  }

  ready(): Promise<void> {
    return this.refreshPromise;
  }

  readyGraph(): Promise<void> {
    return this.graphPromise;
  }

  readySignals(): Promise<void> {
    return this.signalPromise;
  }

  private async refresh(): Promise<void> {
    this.loading = true;
    this.error = undefined;
    try {
      this.evaluations = await this.source.list();
    } catch (error) {
      this.evaluations = [];
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  itemCount(): number {
    return Math.max(1, this.evaluations.length);
  }

  activate(): ViewAction {
    this.refreshPromise = this.refresh();
    return { type: 'busy', verb: 'Loading HEAE history', durationMs: 450, done: 'HEAE history refreshed' };
  }

  handleKey(key: string, state: TuiState): boolean {
    if (key === 'r') {
      this.refreshPromise = this.refresh();
      return true;
    }

    const tab = state.activeTab % this.tabs.length;
    if (tab === 4) {
      if (key === 'v') {
        this.graphPresentation = this.graphPresentation === 'visual' ? 'list' : 'visual';
        this.graphPanX = 0;
        this.graphPanY = 0;
        this.graphInspectorScrollOffset = 0;
        return true;
      }
      if (key === 'n' || key === 'e') {
        this.graphFocus = key === 'n' ? 'nodes' : 'edges';
        return true;
      }
      if (key === 'pageup' || key === 'pagedown' || key === 'home' || key === 'end') {
        const step = Math.max(1, this.graphPanelHeight - 5);
        if (key === 'pageup') this.graphPanY = Math.max(0, this.graphPanY - step);
        if (key === 'pagedown') this.graphPanY += step;
        if (key === 'home') this.graphPanY = 0;
        if (key === 'end') this.graphPanY = Number.MAX_SAFE_INTEGER;
        if (key === 'pageup') this.graphInspectorScrollOffset = Math.max(0, this.graphInspectorScrollOffset - step);
        if (key === 'pagedown') this.graphInspectorScrollOffset += step;
        if (key === 'home') this.graphInspectorScrollOffset = 0;
        if (key === 'end') this.graphInspectorScrollOffset = Number.MAX_SAFE_INTEGER;
        return true;
      }
      if (key === '[' || key === ']') {
        this.graphPanX = Math.max(0, this.graphPanX + (key === '[' ? -4 : 4));
        return true;
      }
      if (key === 'up' || key === 'k' || key === 'down' || key === 'j') {
        const step = key === 'up' || key === 'k' ? -1 : 1;
        if (this.graphFocus === 'nodes') {
          this.graphNodeIndex = Math.max(
            0,
            Math.min((this.graph?.nodes.length ?? 1) - 1, this.graphNodeIndex + step),
          );
          this.ensureGraphNodeVisible();
        } else {
          this.graphEdgeIndex = Math.max(
            0,
            Math.min((this.graph?.edges.length ?? 1) - 1, this.graphEdgeIndex + step),
          );
          const edge = this.graph?.edges[this.graphEdgeIndex];
          const targetIndex = this.graph?.nodes.findIndex((node) => node.id === edge?.target);
          if (targetIndex !== undefined && targetIndex >= 0) {
            this.graphNodeIndex = targetIndex;
            this.ensureGraphNodeVisible();
          }
        }
        return true;
      }
    }
    if (tab === 5 && (key === 'up' || key === 'k' || key === 'down' || key === 'j')) {
      const step = key === 'up' || key === 'k' ? -1 : 1;
      this.signalRecordIndex = Math.max(
        0,
        Math.min(this.signals.length - 1, this.signalRecordIndex + step),
      );
      return true;
    }
    if (tab === 6 && (key === 'up' || key === 'k' || key === 'down' || key === 'j')) {
      const step = key === 'up' || key === 'k' ? -1 : 1;
      this.resultsScrollOffset = Math.max(0, this.resultsScrollOffset + step);
      return true;
    }
    if (tab === 6 && (key === 'pageup' || key === 'pagedown' || key === 'home' || key === 'end')) {
      const step = Math.max(1, this.graphPanelHeight - 5);
      if (key === 'pageup') this.resultsScrollOffset = Math.max(0, this.resultsScrollOffset - step);
      if (key === 'pagedown') this.resultsScrollOffset += step;
      if (key === 'home') this.resultsScrollOffset = 0;
      if (key === 'end') this.resultsScrollOffset = Number.MAX_SAFE_INTEGER;
      return true;
    }
    if ((tab === 2 || tab === 3) && (key === 'up' || key === 'k' || key === 'down' || key === 'j')) {
      const step = key === 'up' || key === 'k' ? -1 : 1;
      this.detailScrollOffset = Math.max(0, this.detailScrollOffset + step);
      return true;
    }

    return false;
  }

  status(state: TuiState): string {
    const tab = this.tabs[state.activeTab % this.tabs.length] ?? this.tabs[0]!;
    if (this.loading) return `${tab} · loading persisted evaluations`;
    if (this.error) return `${tab} · persistence unavailable`;
    return `${tab} · ${this.evaluations.length} persisted evaluation(s) · read-only`;
  }

  render(state: TuiState): string {
    const theme = getTheme(state.theme);
    const { width, height } = state;
    const activeTab = state.activeTab % this.tabs.length;
    if (this.lastRenderedTab !== activeTab) {
      this.detailScrollOffset = 0;
      this.signalRecordIndex = 0;
      this.signalRecordHeight = 1;
      this.graphInspectorScrollOffset = 0;
      this.resultsScrollOffset = 0;
      this.lastRenderedTab = activeTab;
    }
    const selected = Math.min(state.selectedItemIndex, Math.max(0, this.evaluations.length - 1));
    const evaluation = this.evaluations[selected];
    if (activeTab === 6 && this.resultsTraceId !== evaluation?.traceId) {
      this.resultsTraceId = evaluation?.traceId;
      this.resultsScrollOffset = 0;
    }
    if (activeTab === 4 && evaluation) this.ensureGraph(evaluation.traceId);
    if (activeTab === 5 && evaluation) this.ensureSignals(evaluation.traceId);
    const graphInnerWidth = width < 120 ? width - 2 : Math.floor((width - 1) * 0.68) - 2;
    this.graphPanelWidth = graphInnerWidth;
    this.graphVisualActive = activeTab === 4
      && this.graphPresentation === 'visual'
      && this.graph !== undefined
      && graphVisualSupported(this.graph, graphInnerWidth);
    if (activeTab === 5 && this.signals.length > 0) {
      this.signalRecordHeight = this.signalRecordLines(this.signals[0]!, theme).length;
    }
    const header = renderTopHeader(
      'soa heae',
      this.title,
      'PERSISTED DATA · deterministic rules & optional judge results',
      theme,
      width,
    );
    const controls = renderControlBar({
      themeName: state.theme,
      tabs: this.tabs,
      activeTab: state.activeTab,
      leftBadge: `${theme.accent}${ANSI.bold}SOURCE:${ANSI.reset} ${renderBadge('Local HEAE History', 'info', theme)}`,
      theme,
      width,
    });
    const left = (innerWidth: number): string[] => {
      const tab = activeTab;
      if (tab === 0) return this.overview(theme);
      if (tab === 1) return this.saved(innerWidth, theme, selected);
      if (tab === 2) return this.failures(theme, evaluation);
      if (tab === 3) return this.evidence(theme, evaluation);
      if (tab === 4) return this.graphPanel(innerWidth, theme, evaluation);
      if (tab === 5) return this.signalOverview(theme, evaluation);
      return this.results(theme, evaluation);
    };
    const right = (innerWidth: number): string[] => {
      const lines = [
        sectionLabel('Persistence', theme),
        '',
        `  ${theme.fgMuted}record source${ANSI.reset}  heae/evaluations/*.json`,
        `  ${theme.fgMuted}graph source${ANSI.reset}   store/graphs/heae.kuzu`,
        '',
      ];
      if (this.loading) lines.push(`  ${renderBadge('LOADING', 'info', theme)} persisted evaluations`);
      else if (this.error) lines.push(`  ${renderBadge('UNAVAILABLE', 'error', theme)} ${this.error}`);
      else lines.push(`  ${renderBadge('CONNECTED', 'built', theme)} ${this.evaluations.length} validated record(s)`);
      lines.push(
        '',
        `${theme.border}${'─'.repeat(Math.max(0, innerWidth))}${ANSI.reset}`,
        '',
        sectionLabel('Data discipline', theme),
        '',
        `  ${theme.fgMuted}Only persisted HEAE records are shown.${ANSI.reset}`,
        `  ${theme.fgMuted}No synthetic values are injected by this view.${ANSI.reset}`,
        `  ${theme.fgMuted}Hypotheses remain unverified unless a${ANSI.reset}`,
        `  ${theme.fgMuted}stored judge result explicitly says otherwise.${ANSI.reset}`,
      );
      return lines;
    };
    const panels = (panelHeight: number) => {
      this.graphPanelHeight = panelHeight;
      return renderPanels(
        {
        title: this.tabs[activeTab] ?? 'Overview',
        active: true,
        build: left,
        focus: activeTab === 1
          ? [selected, selected + 1]
          : activeTab === 4 && !this.graphVisualActive
            ? [this.graphNodeIndex + 4, this.graphNodeIndex + 5]
            : undefined,
        scrollOffset: activeTab === 2 || activeTab === 3
          ? this.detailScrollOffset
          : activeTab === 6
            ? this.resultsScrollOffset
          : this.graphVisualActive
            ? this.graphPanY
            : undefined,
      },
      {
        title: activeTab === 4
          ? this.graphVisualActive
            ? 'Node Inspector'
            : 'Recorded Relationships'
          : activeTab === 5
          ? 'Published Signals'
            : activeTab === 6
              ? 'Result Status'
              : 'HEAE Data Status',
        build: activeTab === 4
          ? (innerWidth) => this.graphVisualActive
            ? this.graphInspector(innerWidth, theme, evaluation)
            : this.graphEdges(innerWidth, theme, evaluation)
          : activeTab === 5
            ? () => this.signalRecords(theme, evaluation)
          : activeTab === 6
            ? () => this.resultStatus(theme, evaluation)
          : right,
        scrollOffset: this.graphVisualActive
          ? this.graphInspectorScrollOffset
          : activeTab === 6
            ? this.resultsScrollOffset
            : undefined,
        focus: activeTab === 5
          ? this.signalFocus()
          : activeTab === 4 && !this.graphVisualActive
            ? [this.graphEdgeIndex + 3, this.graphEdgeIndex + 4]
            : undefined,
      },
      { width, height: panelHeight, ratio: 0.68, theme },
      );
    };
    return vstack(
      [toLines(header), spacer(height), toLines(controls), spacer(height), { grow: 1, render: panels }],
      width,
      height,
    ).join('\n');
  }

  private ensureGraph(traceId: string): void {
    if (this.graphTraceId === traceId) return;
    this.graphTraceId = traceId;
    this.graph = undefined;
    this.graphError = undefined;
    this.graphLoading = true;
    this.graphNodeIndex = 0;
    this.graphEdgeIndex = 0;
    const requestedTraceId = traceId;
    this.graphPromise = (this.source.loadGraph
      ? this.source.loadGraph(traceId)
      : Promise.reject(new Error('HEAE graph reader is unavailable')))
      .then((graph) => {
        if (this.graphTraceId === requestedTraceId) this.graph = graph ?? undefined;
      })
      .catch((error: unknown) => {
        if (this.graphTraceId === requestedTraceId) {
          this.graphError = error instanceof Error ? error.message : String(error);
        }
      })
      .finally(() => {
        if (this.graphTraceId === requestedTraceId) this.graphLoading = false;
      });
  }

  private ensureSignals(traceId: string): void {
    if (this.signalTraceId === traceId) return;
    this.signalTraceId = traceId;
    this.signals = [];
    this.signalError = undefined;
    this.signalLoading = true;
    this.signalPromise = (this.source.listSignals
      ? this.source.listSignals(traceId)
      : Promise.reject(new Error('HEAE signal reader is unavailable')))
      .then((signals) => {
        if (this.signalTraceId === traceId) {
          this.signals = signals.filter((signal) => signal.trace_id === traceId);
        }
      })
      .catch((error: unknown) => {
        if (this.signalTraceId === traceId) {
          this.signalError = error instanceof Error ? error.message : String(error);
        }
      })
      .finally(() => {
        if (this.signalTraceId === traceId) this.signalLoading = false;
      });
  }

  private graphState(theme: ThemeColors): string[] {
    if (this.graphLoading) return [`  ${renderBadge('LOADING', 'info', theme)} Reading persisted trace graph...`];
    if (this.graphError) return [`  ${renderBadge('ERROR', 'error', theme)} ${this.graphError}`];
    if (!this.graph) return [`  ${renderBadge('MISSING', 'warn', theme)} No persisted graph is available for this trace.`];
    return [];
  }

  private ensureGraphNodeVisible(): void {
    if (!this.graph || !this.graphVisualActive || this.graphPanelHeight <= 0) return;
    const layout = layoutGraph(this.graph);
    const node = layout.nodes[this.graphNodeIndex];
    if (!node) return;
    const viewportHeight = Math.max(1, this.graphPanelHeight - 2);
    if (node.y < this.graphPanY) this.graphPanY = node.y;
    if (node.y + GRAPH_NODE_HEIGHT > this.graphPanY + viewportHeight) {
      this.graphPanY = node.y + GRAPH_NODE_HEIGHT - viewportHeight;
    }
    if (node.x < this.graphPanX) this.graphPanX = node.x;
    if (node.x + node.width > this.graphPanX + this.graphPanelWidth) {
      this.graphPanX = node.x + node.width - this.graphPanelWidth;
    }
    this.graphPanY = Math.max(0, this.graphPanY);
    this.graphPanX = Math.max(0, this.graphPanX);
  }

  private graphPanel(innerWidth: number, theme: ThemeColors, evaluation?: StoredEvaluation): string[] {
    if (!evaluation) return ['  Select a persisted evaluation in Saved Evaluations.'];
    const state = this.graphState(theme);
    if (state.length > 0) return state;
    const graph = this.graph!;
    if (this.graphPresentation === 'visual' && graphVisualSupported(graph, innerWidth)) {
      return this.graphVisual(innerWidth, theme, graph);
    }
    const lines = this.graphNodes(innerWidth, theme, evaluation);
    if (this.graphPresentation === 'visual') {
      lines.unshift(
        `  ${renderBadge('LIST FALLBACK', 'info', theme)} Visual layout unavailable for this terminal/graph size; press v to toggle list mode.`,
        '',
      );
    }
    return lines;
  }

  private graphVisual(innerWidth: number, theme: ThemeColors, graph: TraceGraph): string[] {
    const layout = layoutGraph(graph);
    const canvasWidth = layout.width + 8;
    const viewportHeight = Math.max(1, this.graphPanelHeight - 2);
    const maxPanY = Math.max(0, layout.height - viewportHeight);
    const panY = Math.min(this.graphPanY, maxPanY);
    this.graphPanY = panY;
    const visibleWidth = Math.max(1, innerWidth);
    const matrix = Array.from(
      { length: layout.height + 1 },
      () => Array.from({ length: canvasWidth }, () => ' '),
    );
    const put = (x: number, y: number, character: string): void => {
      if (y >= 0 && y < matrix.length && x >= 0 && x < canvasWidth) matrix[y]![x] = character;
    };
    const edgeChars = (type: TraceGraph['edges'][number]['type']) =>
      type === 'PARENT_OF' ? { horizontal: '─', vertical: '│' } : { horizontal: '┄', vertical: '┆' };
    const indexById = new Map(graph.nodes.map((node, index) => [node.id, index]));

    graph.edges.forEach((edge, edgeIndex) => {
      const sourceIndex = indexById.get(edge.source);
      const targetIndex = indexById.get(edge.target);
      if (sourceIndex === undefined || targetIndex === undefined) return;
      const source = layout.nodes[sourceIndex]!;
      const target = layout.nodes[targetIndex]!;
      const chars = edgeChars(edge.type);
      const sourceX = source.x + source.width - 1;
      const sourceY = source.y + 1;
      const targetX = target.x;
      const targetY = target.y + 1;
      if (target.x > source.x) {
        for (let x = sourceX; x < targetX; x += 1) put(x, sourceY, chars.horizontal);
        const bendX = targetX - 1;
        const top = Math.min(sourceY, targetY);
        const bottom = Math.max(sourceY, targetY);
        for (let y = top; y <= bottom; y += 1) put(bendX, y, chars.vertical);
        put(bendX, targetY, '▶');
      } else {
        // Back-edges, self-loops and same-layer links route to the right of the
        // layered canvas. The fixed lane offset is deterministic and bounded.
        const laneX = layout.width + 1 + (edgeIndex % 3) * 2;
        for (let x = sourceX; x <= laneX; x += 1) put(x, sourceY, chars.horizontal);
        const top = Math.min(sourceY, targetY);
        const bottom = Math.max(sourceY, targetY);
        for (let y = top; y <= bottom; y += 1) put(laneX, y, chars.vertical);
        for (let x = targetX - 1; x <= laneX; x += 1) put(x, targetY, chars.horizontal);
        put(targetX - 1, targetY, '▶');
      }
    });

    graph.nodes.forEach((node, index) => {
      const position = layout.nodes[index]!;
      const selected = index === this.graphNodeIndex;
      const id = node.id.length > position.width - 4
        ? `${node.id.slice(0, position.width - 7)}...`
        : node.id;
      const type = node.type.length > position.width - 4
        ? `${node.type.slice(0, position.width - 7)}...`
        : node.type;
      put(position.x, position.y, selected ? '◆' : '┌');
      put(position.x + position.width - 1, position.y, selected ? '◆' : '┐');
      for (let x = position.x + 1; x < position.x + position.width - 1; x += 1) put(x, position.y, '─');
      put(position.x, position.y + 1, '│');
      put(position.x + position.width - 1, position.y + 1, '│');
      put(position.x, position.y + 3, selected ? '◆' : '└');
      put(position.x + position.width - 1, position.y + 3, selected ? '◆' : '┘');
      for (let x = position.x + 1; x < position.x + position.width - 1; x += 1) put(x, position.y + 3, '─');
      for (const [offset, text] of [[1, `${selected ? '▸ ' : '  '}${type}`], [2, `  ${id}`]] as const) {
        const available = position.width - 2;
        const padded = text.slice(0, available).padEnd(available, ' ');
        for (let x = 0; x < padded.length; x += 1) put(position.x + 1 + x, position.y + offset, padded[x]!);
      }
    });

    const visibleEdges = graph.edges.filter((edge) => {
      const source = layout.nodes[indexById.get(edge.source) ?? -1];
      const target = layout.nodes[indexById.get(edge.target) ?? -1];
      if (!source || !target) return false;
      return Math.max(source.y, target.y) >= panY
        && Math.min(source.y, target.y) < panY + viewportHeight
        && Math.max(source.x, target.x) >= this.graphPanX
        && Math.min(source.x, target.x) < this.graphPanX + visibleWidth;
    }).length;
    const outsideEdges = graph.edges.length - visibleEdges;
    const lines = matrix.map((row) => sliceAnsi(`${theme.fg}${row.join('')}${ANSI.reset}`, this.graphPanX, visibleWidth));
    lines.push(
      '',
      `  ${theme.fgMuted}Legend:${ANSI.reset} ${theme.fg}─│ PARENT_OF${ANSI.reset}  ${theme.fgMuted}┄┆ CAUSED_BY${ANSI.reset}  ${theme.fgMuted}◆ selected${ANSI.reset}`,
      `  ${theme.fgMuted}Recorded relationships only; CAUSED_BY is not verified root causality.${ANSI.reset}`,
      `  ${theme.fgMuted}${graph.nodes.length} node(s) · ${graph.edges.length} relationship(s) · v list view · [ ] pan · PageUp/PageDown scroll${ANSI.reset}`,
    );
    if (outsideEdges > 0) {
      lines.push(`  ${renderBadge('CLIPPED', 'warn', theme)} ${outsideEdges} edge(s) are outside this viewport; press v for every recorded relationship.`);
    }
    return lines;
  }

  private graphInspector(innerWidth: number, theme: ThemeColors, evaluation?: StoredEvaluation): string[] {
    if (!evaluation) return ['  Select a persisted evaluation in Saved Evaluations.'];
    const graph = this.graph;
    if (!graph) return this.graphState(theme);
    const node = graph.nodes[this.graphNodeIndex];
    if (!node) return ['  No persisted node is selected.'];
    const incoming = graph.edges.filter((edge) => edge.target === node.id);
    const outgoing = graph.edges.filter((edge) => edge.source === node.id);
    const span = node.span as unknown as Record<string, unknown>;
    const metadata = ['name', 'kind', 'status', 'attributes']
      .filter((key) => span[key] !== undefined)
      .map((key) => `  ${key}: ${JSON.stringify(span[key])}`);
    const selectedEdge = this.graphFocus === 'edges' ? graph.edges[this.graphEdgeIndex] : undefined;
    const lines = [
      `  ${renderBadge('SELECTED NODE', 'built', theme)} ${node.type}`,
      `  id: ${node.id}`,
      '',
      sectionLabel('Relationships', theme),
      '',
    ];
    if (selectedEdge) lines.push(`  focused edge: ${selectedEdge.source} -[${selectedEdge.type}]-> ${selectedEdge.target}`);
    lines.push(...(incoming.length > 0 ? incoming.map((edge) => `  in  ${edge.type} from ${edge.source}`) : ['  in  none recorded']));
    lines.push(...(outgoing.length > 0 ? outgoing.map((edge) => `  out ${edge.type} to ${edge.target}`) : ['  out none recorded']));
    lines.push('', sectionLabel('Stored span metadata', theme), '', ...(metadata.length > 0 ? metadata : ['  No additional metadata recorded.']));
    lines.push('', `  ${theme.fgMuted}n/e focus nodes or relationships · arrows navigate · v list view${ANSI.reset}`);
    return lines.map((line) => line.length > innerWidth + 12 ? `${line.slice(0, innerWidth + 9)}...` : line);
  }

  private graphNodes(innerWidth: number, theme: ThemeColors, evaluation?: StoredEvaluation): string[] {
    if (!evaluation) return ['  Select a persisted evaluation in Saved Evaluations.'];
    const state = this.graphState(theme);
    if (state.length > 0) return state;
    const graph = this.graph!;
    const lines = [
      `  Trace ${graph.traceId}`,
      `  ${graph.nodes.length} node(s) · ${graph.edges.length} relationship(s)`,
      '',
      sectionLabel('Nodes · press n to focus', theme),
    ];
    graph.nodes.forEach((node, index) => {
      const row = `  ${index === this.graphNodeIndex ? '▸' : ' '} ${node.id}  ${node.type}`;
      lines.push(index === this.graphNodeIndex ? highlightRow(row, Math.max(1, innerWidth), theme) : row);
    });
    lines.push('', `  ${theme.fgMuted}Recorded graph data only; relationships are not proof of root causality.${ANSI.reset}`);
    return lines;
  }

  private graphEdges(_innerWidth: number, theme: ThemeColors, evaluation?: StoredEvaluation): string[] {
    if (!evaluation) return ['  Select a persisted evaluation in Saved Evaluations.'];
    const state = this.graphState(theme);
    if (state.length > 0) return state;
    const graph = this.graph!;
    const lines = [
      `  ${graph.edges.length} recorded relationship(s)`,
      '',
      sectionLabel('Relationships · press e to focus', theme),
    ];
    graph.edges.forEach((edge, index) => {
      const row = `  ${index === this.graphEdgeIndex ? '▸' : ' '} ${edge.source} -[${edge.type}]-> ${edge.target}`;
      lines.push(index === this.graphEdgeIndex ? highlightRow(row, Math.max(1, _innerWidth), theme) : row);
    });
    lines.push('', `  ${theme.fgMuted}CAUSED_BY is a recorded relationship, not a verified causal conclusion.${ANSI.reset}`);
    return lines;
  }

  private signalDecision(
    evaluation: StoredEvaluation,
  ): { status: 'already published' | 'skipped' | 'unavailable'; reason: string } {
    if (this.signals.length > 0) {
      const proposal = this.proposalFromSignal(this.signals[0]!);
      const generated = generateOptimizationSignal(evaluation.result, proposal);
      return {
        status: 'already published',
        reason: generated.status === 'generated'
          ? 'A validated OptimizationSignal record exists for this trace.'
          : 'A validated OptimizationSignal record exists, although current stored evaluation data would not regenerate it.',
      };
    }

    const attribution = evaluation.result;
    if (attribution.judgeStatus !== 'completed' || !attribution.judgment) {
      return { status: 'skipped', reason: 'LLM judgment is unavailable.' };
    }
    if (attribution.ruleReport.outcome === 'pass') {
      return { status: 'skipped', reason: 'The evaluated task completed successfully.' };
    }
    if (attribution.ruleReport.hypotheses.length === 0) {
      return { status: 'skipped', reason: 'No matching rule-based hypothesis.' };
    }
    const supported = attribution.ruleReport.hypotheses.some((hypothesis) =>
      attribution.judgment?.findings.some(
        (finding) => finding.category === hypothesis.category && finding.assessment === 'supported',
      ),
    );
    if (!supported) {
      return { status: 'skipped', reason: 'The hypothesis is not supported by the judge.' };
    }
    return {
      status: 'unavailable',
      reason: 'No reviewed optimization proposal is persisted; eligibility cannot be established read-only.',
    };
  }

  private proposalFromSignal(signal: OptimizationSignal): ReviewedOptimizationProposal {
    return {
      reviewed: true,
      signalId: signal.signal_id,
      groupId: signal.group_id,
      runId: signal.run_id,
      taskId: signal.task_id,
      failureClass: signal.failure_class,
      rootCauseSummary: signal.root_cause.summary,
      evidenceNodeIds: signal.root_cause.evidence_node_ids,
      targetAxis: signal.target.axis,
      configPath: signal.target.config_path,
      affectedSubtask: signal.target.affected_subtask,
      suggestedAction: signal.suggested_action,
      confidence: signal.confidence,
      configVersionAtFailure: signal.config_version_at_failure,
    };
  }

  private signalOverview(theme: ThemeColors, evaluation?: StoredEvaluation): string[] {
    if (!evaluation) return ['  Select a persisted evaluation in Saved Evaluations.'];
    if (this.signalLoading) return [`  ${renderBadge('LOADING', 'info', theme)} Reading published signal records...`];
    if (this.signalError) return [`  ${renderBadge('ERROR', 'error', theme)} ${this.signalError}`];
    const decision = this.signalDecision(evaluation);
    const lines = [
      `  Trace ${evaluation.traceId}`,
      '',
      `  ${renderBadge(decision.status.toUpperCase(), decision.status === 'already published' ? 'built' : decision.status === 'skipped' ? 'warn' : 'info', theme)} ${decision.reason}`,
      '',
      sectionLabel('Read-only eligibility checks', theme),
      '',
      `  Judge status: ${evaluation.result.judgeStatus}`,
      `  Rule hypotheses: ${evaluation.result.ruleReport.hypotheses.length}`,
      `  Published matching signals: ${this.signals.length}`,
      '',
      `  ${theme.fgMuted}No signal is generated, persisted, published, or sent downstream by this tab.${ANSI.reset}`,
    ];
    return lines;
  }

  private signalRecords(theme: ThemeColors, evaluation?: StoredEvaluation): string[] {
    if (!evaluation) return ['  Select a persisted evaluation in Saved Evaluations.'];
    if (this.signalLoading) return [`  ${renderBadge('LOADING', 'info', theme)} Reading events/optimization_signals.jsonl...`];
    if (this.signalError) return [`  ${renderBadge('ERROR', 'error', theme)} ${this.signalError}`];
    if (this.signals.length === 0) {
      return [
        `  ${renderBadge('EMPTY', 'info', theme)} No published OptimizationSignal matches ${evaluation.traceId}.`,
        '',
        `  ${theme.fgMuted}A skipped or unavailable evaluation has no publication record here.${ANSI.reset}`,
      ];
    }
    const lines = [sectionLabel('Persisted OptimizationSignal records', theme), ''];
    this.signalRecordHeight = this.signalRecordLines(this.signals[0]!, theme).length;
    for (const signal of this.signals) {
      lines.push(...this.signalRecordLines(signal, theme));
    }
    return lines;
  }

  private signalFocus(): [number, number] | undefined {
    if (this.signals.length === 0) return undefined;
    const start = 2 + this.signalRecordIndex * this.signalRecordHeight;
    return [start, start + this.signalRecordHeight];
  }

  private signalRecordLines(signal: OptimizationSignal, theme: ThemeColors): string[] {
    return [
      `  ${renderBadge('PUBLISHED', 'built', theme)} ${signal.signal_id}`,
      `     schema: ${signal.schema_version} · trace: ${signal.trace_id}`,
      `     evidence: ${signal.root_cause.evidence_node_ids.join(', ') || 'none recorded'}`,
      `     classifier: ${signal.classifier} · action: ${signal.suggested_action}`,
      `     ${theme.fgMuted}The persisted event is evidence of publication, not proof of root causality.${ANSI.reset}`,
    ];
  }

  private results(theme: ThemeColors, evaluation?: StoredEvaluation): string[] {
    if (!evaluation) return ['  Select a persisted evaluation in Saved Evaluations.'];

    const { result } = evaluation;
    const report = result.ruleReport;
    const judgment = result.judgment;
    const lines = [
      `  Trace ID: ${evaluation.traceId}`,
      `  Record: ${renderBadge('PERSISTED', 'built', theme)} HEAE evaluation`,
      `  Schema version: ${evaluation.schemaVersion}`,
      `  Trace fingerprint: ${evaluation.traceFingerprint ? 'present' : 'not recorded'}`,
      '  Evaluation timestamp: unavailable (not persisted in StoredEvaluation)',
      '',
      sectionLabel('Recorded outcome', theme),
      '',
      `  ${outcomeBadge(report.outcome, theme)} rule outcome`,
      `  Rule observations: ${report.observations.length}`,
      `  Rule hypotheses: ${report.hypotheses.length} (unverified)`,
      `  Rule checks require judge: ${report.requiresJudge ? 'yes' : 'no'}`,
      '',
      sectionLabel('Deterministic rule findings', theme),
      '',
    ];

    if (report.observations.length === 0) {
      lines.push('  No deterministic rule observations were recorded.');
    } else {
      for (const finding of report.observations) {
        lines.push(
          `  ${renderBadge(finding.category.toUpperCase(), 'warn', theme)} ${finding.ruleId}: ${finding.observation}`,
          `     evidence: ${finding.evidenceNodeIds.join(', ') || 'none recorded'}`,
        );
        if (Object.keys(finding.details).length > 0) {
          lines.push(`     details: ${JSON.stringify(finding.details)}`);
        }
      }
    }

    lines.push('', sectionLabel('Rule-based hypotheses', theme), '');
    if (report.hypotheses.length === 0) {
      lines.push('  No rule-based hypotheses were recorded.');
    } else {
      for (const hypothesis of report.hypotheses) {
        lines.push(
          `  ${renderBadge(hypothesis.status.toUpperCase(), 'info', theme)} ${hypothesis.category}: ${hypothesis.summary}`,
          `     supporting rules: ${hypothesis.supportingRuleIds.join(', ') || 'none recorded'}`,
          `     evidence: ${hypothesis.evidenceNodeIds.join(', ') || 'none recorded'}`,
          `     limitations: ${hypothesis.limitations.join('; ') || 'none recorded'}`,
        );
      }
    }

    lines.push('', sectionLabel('Recorded LLM judgment', theme), '', `  Judge status: ${result.judgeStatus}`);
    if (result.judgeStatus !== 'completed') {
      lines.push(`  ${renderBadge(result.judgeStatus.toUpperCase(), 'info', theme)} No completed LLM assessment is recorded.`);
    } else if (!judgment) {
      lines.push(`  ${renderBadge('UNAVAILABLE', 'error', theme)} The completed status has no persisted judgment payload.`);
    } else if (judgment.findings.length === 0) {
      lines.push('  The completed LLM judgment contains no findings.');
    } else {
      for (const finding of judgment.findings) {
        lines.push(
          `  ${renderBadge(finding.assessment.toUpperCase(), finding.assessment === 'supported' ? 'built' : 'info', theme)} ${finding.category}`,
          `     explanation: ${finding.explanation}`,
          `     evidence: ${finding.evidenceNodeIds.join(', ') || 'none recorded'}`,
          `     limitations: ${finding.limitations.join('; ') || 'none recorded'}`,
        );
      }
      lines.push('', '  Overall uncertainty:', `  ${judgment.overallUncertainty}`);
      lines.push(`  ${theme.fgMuted}Recorded assessment only; it is not proof of root causality.${ANSI.reset}`);
    }

    if (result.warnings.length > 0 || report.warnings.length > 0) {
      lines.push('', sectionLabel('Persisted warnings', theme), '');
      lines.push(...[...report.warnings, ...result.warnings].map((warning) => `  ${renderBadge('WARNING', 'warn', theme)} ${warning}`));
    }
    lines.push(
      '',
      sectionLabel('Unavailable metrics', theme),
      '',
      '  Benchmark score: unavailable (not persisted)',
      '  Accuracy, latency, token usage, cost and confidence: unavailable (not persisted)',
      '  Comparative results: unavailable (no comparison record persisted)',
    );
    return lines;
  }

  private resultStatus(theme: ThemeColors, evaluation?: StoredEvaluation): string[] {
    if (!evaluation) return ['  Select a persisted evaluation in Saved Evaluations.'];
    const { result } = evaluation;
    return [
      sectionLabel('Persisted result status', theme),
      '',
      `  trace: ${evaluation.traceId}`,
      '  record: persisted',
      `  outcome: ${result.ruleReport.outcome}`,
      `  Judge status: ${result.judgeStatus}`,
      `  observations: ${result.ruleReport.observations.length}`,
      `  hypotheses: ${result.ruleReport.hypotheses.length}`,
      `  judgment findings: ${result.judgment?.findings.length ?? 'unavailable'}`,
      '',
      sectionLabel('Metrics', theme),
      '',
      '  No numerical evaluation metrics are persisted for this record.',
      '',
      `  ${theme.fgMuted}This panel reports stored fields only; it never reruns evaluation or invokes a judge.${ANSI.reset}`,
    ];
  }

  private overview(theme: ThemeColors): string[] {
    if (this.loading) return [`  ${renderBadge('LOADING', 'info', theme)} Reading EvaluationHistory...`];
    if (this.error) return [`  ${renderBadge('ERROR', 'error', theme)} ${this.error}`];
    if (this.evaluations.length === 0) {
      return [
        '  No persisted HEAE evaluations found.',
        '',
        `  ${theme.fgMuted}Run a HEAE evaluation with persistence, then press r to refresh.${ANSI.reset}`,
      ];
    }
    const outcomes = this.evaluations.reduce<Record<string, number>>((counts, item) => {
      const outcome = item.result.ruleReport.outcome;
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      return counts;
    }, {});
    return [
      `  ${theme.fg}${ANSI.bold}Persisted evaluation overview${ANSI.reset}`,
      '',
      `  Evaluations: ${this.evaluations.length}`,
      `  Pass: ${outcomes.pass ?? 0}   Fail: ${outcomes.fail ?? 0}   Error: ${outcomes.error ?? 0}   Unknown: ${outcomes.unknown ?? 0}`,
      '',
      `  ${theme.fgMuted}Records are loaded through EvaluationHistory and retain${ANSI.reset}`,
      `  ${theme.fgMuted}the backend's observations, hypotheses, warnings,${ANSI.reset}`,
      `  ${theme.fgMuted}and judge status without recomputation.${ANSI.reset}`,
    ];
  }

  private saved(innerWidth: number, theme: ThemeColors, selected: number): string[] {
    if (this.loading) return [`  ${renderBadge('LOADING', 'info', theme)} Reading saved evaluations...`];
    if (this.error) return [`  ${renderBadge('ERROR', 'error', theme)} ${this.error}`];
    if (this.evaluations.length === 0) return ['  No saved evaluations.'];
    return this.evaluations.flatMap((item, index) => {
      const report = item.result.ruleReport;
      const row = ` ${index === selected ? '▸' : ' '} ${item.traceId}  ${outcomeBadge(report.outcome, theme)}  ${pluralize(report.observations.length, 'finding', 'findings')} · ${pluralize(report.hypotheses.length, 'hypothesis', 'hypotheses')}`;
      return [index === selected ? highlightRow(row, Math.max(1, innerWidth - 2), theme) : row, `     judge: ${item.result.judgeStatus} · fingerprint: ${item.traceFingerprint ? 'present' : 'legacy/missing'}`];
    });
  }

  private failures(theme: ThemeColors, evaluation?: StoredEvaluation): string[] {
    if (!evaluation) return ['  Select a persisted evaluation in Saved Evaluations.'];
    const report = evaluation.result.ruleReport;
    const lines = [`  Trace ${evaluation.traceId}  ${outcomeBadge(report.outcome, theme)}`, '', sectionLabel('Rule observations', theme), ''];
    if (report.observations.length === 0) lines.push('  No deterministic rule observations were recorded.');
    for (const finding of report.observations) {
      lines.push(`  ${renderBadge(finding.category.toUpperCase(), 'warn', theme)} ${finding.ruleId}: ${finding.observation}`, `     evidence: ${finding.evidenceNodeIds.join(', ') || 'none recorded'}`);
    }
    lines.push('', sectionLabel('Attribution hypotheses', theme), '');
    if (report.hypotheses.length === 0) lines.push('  No attribution hypotheses were recorded.');
    for (const hypothesis of report.hypotheses) lines.push(`  ${renderBadge(hypothesis.status.toUpperCase(), 'info', theme)} ${hypothesis.category}: ${hypothesis.summary}`);
    return lines;
  }

  private evidence(theme: ThemeColors, evaluation?: StoredEvaluation): string[] {
    if (!evaluation) return ['  Select a persisted evaluation in Saved Evaluations.'];
    const report = evaluation.result.ruleReport;
    const evidence = [...new Set(report.observations.flatMap((finding) => finding.evidenceNodeIds))];
    const judgment = evaluation.result.judgment;
    const lines = [
      `  Trace ${evaluation.traceId}`,
      `  Judge status: ${evaluation.result.judgeStatus}`,
      '',
      sectionLabel('Rule-based attribution', theme),
      '',
      `  ${renderBadge('UNVERIFIED', 'warn', theme)} Hypotheses are not root-cause findings.`,
      `  ${theme.fgMuted}Rule observations identify recorded patterns; they do not establish causality.${ANSI.reset}`,
      '',
      sectionLabel('Rule evidence node IDs', theme),
      '',
    ];
    lines.push(...(evidence.length > 0 ? evidence.map((id) => `  ${renderBadge('SPAN', 'info', theme)} ${id}`) : ['  No evidence node IDs were recorded.']));
    lines.push('', sectionLabel('Rule attribution limits', theme), '');
    const limitations = report.hypotheses.flatMap((hypothesis) => hypothesis.limitations);
    lines.push(...(limitations.length > 0 ? [...new Set(limitations)].map((item) => `  · ${item}`) : ['  No attribution limitations were recorded.']));

    lines.push('', sectionLabel('LLM judgment', theme), '');
    if (evaluation.result.judgeStatus !== 'completed') {
      lines.push(`  ${renderBadge(evaluation.result.judgeStatus.toUpperCase(), 'info', theme)} No completed LLM assessment is recorded.`);
    } else if (!judgment) {
      lines.push(`  ${renderBadge('UNAVAILABLE', 'error', theme)} The record says completed, but contains no judgment payload.`);
    } else if (judgment.findings.length === 0) {
      lines.push('  The completed LLM judgment contains no findings.');
      lines.push(`  ${theme.fgMuted}This does not establish that the task had no failure cause.${ANSI.reset}`);
    } else {
      lines.push(`  ${renderBadge('RECORDED ASSESSMENT', 'built', theme)} Evidence-grounded model assessment; not proof of causality.`);
      for (const finding of judgment.findings) {
        lines.push(
          `  ${renderBadge(finding.assessment.toUpperCase(), finding.assessment === 'supported' ? 'warn' : 'info', theme)} ${finding.category}`,
          `     ${finding.explanation}`,
          `     evidence: ${finding.evidenceNodeIds.join(', ') || 'none recorded'}`,
          ...(finding.limitations.length > 0 ? [`     limitations: ${finding.limitations.join('; ')}`] : []),
        );
      }
    }
    if (judgment) lines.push('', '  Overall uncertainty:', `  ${judgment.overallUncertainty}`);

    if (report.warnings.length > 0) lines.push('', sectionLabel('Warnings', theme), '', ...report.warnings.map((warning) => `  ${renderBadge('WARNING', 'warn', theme)} ${warning}`));
    return lines;
  }
}
