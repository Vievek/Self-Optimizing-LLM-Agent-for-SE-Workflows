import { describe, expect, it } from 'vitest';
import { OptimizationSignalSchema } from '@soa/contracts';
import { stripAnsi } from '../../theme/text.js';
import { TuiApp } from '../../tui/app.js';
import type { TraceGraph } from '@soa/heae';
import { HeaeDashboardView } from './heae-view.js';

const state = {
  activeView: 'heae',
  activeTab: 0,
  theme: 'cyber' as const,
  width: 100,
  height: 30,
  selectedItemIndex: 0,
};

const savedEvaluation = {
  schemaVersion: '1.0' as const,
  traceId: '0123456789abcdef0123456789abcdef',
  traceFingerprint: 'a'.repeat(64),
  result: {
    traceId: '0123456789abcdef0123456789abcdef',
    ruleReport: {
      traceId: '0123456789abcdef0123456789abcdef',
      outcome: 'fail' as const,
      observations: [
        {
          ruleId: 'TOOL-01',
          category: 'tool' as const,
          observation: 'Tool returned a recorded failure',
          evidenceNodeIds: ['span-1'],
          details: {},
        },
      ],
      hypotheses: [
        {
          category: 'tool' as const,
          status: 'unverified' as const,
          summary: 'A tool operation may have contributed',
          supportingRuleIds: ['TOOL-01'],
          evidenceNodeIds: ['span-1'],
          limitations: ['Rule observations do not establish causality'],
        },
      ],
      warnings: [],
      requiresJudge: true,
    },
    judgment: null,
    judgeStatus: 'skipped' as const,
    warnings: [],
  },
};

const graph: TraceGraph = {
  traceId: savedEvaluation.traceId,
  nodes: [
    { id: 'node-task', type: 'TaskNode', span: {} as TraceGraph['nodes'][number]['span'] },
    { id: 'node-tool', type: 'ToolCallNode', span: {} as TraceGraph['nodes'][number]['span'] },
    { id: 'node-output', type: 'OutputNode', span: {} as TraceGraph['nodes'][number]['span'] },
  ],
  edges: [
    { source: 'node-task', target: 'node-tool', type: 'PARENT_OF' },
    { source: 'node-tool', target: 'node-output', type: 'CAUSED_BY' },
  ],
  warnings: [],
};

const insufficientEvaluation = {
  ...savedEvaluation,
  result: {
    ...savedEvaluation.result,
    judgeStatus: 'completed' as const,
    judgment: {
      findings: [
        {
          category: 'tool' as const,
          assessment: 'insufficient_evidence' as const,
          explanation: 'The recorded tool error does not establish its exact cause.',
          evidenceNodeIds: ['span-1'],
          limitations: ['More execution context is required.'],
        },
      ],
      overallUncertainty: 'The precise cause remains uncertain.',
    },
  },
};

const supportedEvaluation = {
  ...insufficientEvaluation,
  result: {
    ...insufficientEvaluation.result,
    judgeProvenance: {
      mode: 'simulated' as const,
      provider: 'simulated-test-provider',
      model: 'simulated-test-judge',
    },
    judgment: {
      ...insufficientEvaluation.result.judgment,
      findings: [
        {
          ...insufficientEvaluation.result.judgment.findings[0]!,
          assessment: 'supported' as const,
        },
      ],
    },
  },
};

const publishedSignal = OptimizationSignalSchema.parse({
  schema_version: '2.0',
  signal_id: 'sig_saved_tool_01',
  group_id: 'group_saved',
  run_id: 'run_saved',
  task_id: 'task_saved',
  trace_id: savedEvaluation.traceId,
  failure_class: 'tool',
  root_cause: {
    summary: 'Reviewed tool execution issue.',
    evidence_node_ids: ['span-1'],
  },
  target: {
    axis: 'tool',
    config_path: 'tools.execution',
    affected_subtask: 'tool_execution',
  },
  suggested_action: 'tool_description_refine',
  confidence: 0.8,
  classifier: 'llm_judge',
  config_version_at_failure: 'cfg_saved',
});

function allDetailScrollFrames(view: HeaeDashboardView, currentState: typeof state): string {
  const frames: string[] = [];
  for (let index = 0; index < 64; index += 1) {
    frames.push(stripAnsi(view.render(currentState)));
    view.handleKey('down', currentState);
  }
  frames.push(stripAnsi(view.render(currentState)));
  return frames.join('\n');
}

describe('HEAE dashboard view', () => {
  it('renders an explicit empty persisted-history state across Phase 1 tabs', async () => {
    const view = new HeaeDashboardView({ list: async () => [] });
    await view.ready();

    expect(stripAnsi(view.render(state))).toContain('No persisted HEAE evaluations found.');

    for (let tab = 1; tab < 7; tab += 1) {
      expect(stripAnsi(view.render({ ...state, activeTab: tab }))).toContain(
        tab === 1 ? 'No saved evaluations.' : 'Select a persisted evaluation',
      );
    }
  });

  it('reports persistence errors instead of substituting demo data', async () => {
    const view = new HeaeDashboardView({
      list: async () => {
        throw new Error('history unavailable');
      },
    });
    await view.ready();

    const output = stripAnsi(view.render(state));
    expect(output).toContain('history unavailable');
    expect(output).not.toContain('Confidence:');
    expect(output).not.toContain('TOOL-02');
  });

  it('renders persisted observations, evidence IDs, and limitations', async () => {
    const view = new HeaeDashboardView({ list: async () => [savedEvaluation] });
    await view.ready();

    expect(stripAnsi(view.render({ ...state, activeTab: 2 }))).toContain('TOOL-01');
    const detailState = { ...state, activeTab: 3 };
    expect(stripAnsi(view.render(detailState))).toContain('span-1');
    const frames = allDetailScrollFrames(view, detailState);
    expect(frames).toContain('do not establish causality');
    expect(frames).toContain('No completed LLM assessment is recorded.');
  });

  it('keeps the selected saved evaluation when switching attribution tabs', async () => {
    const secondEvaluation = {
      ...savedEvaluation,
      traceId: 'fedcba9876543210fedcba9876543210',
      result: {
        ...savedEvaluation.result,
        traceId: 'fedcba9876543210fedcba9876543210',
        ruleReport: {
          ...savedEvaluation.result.ruleReport,
          traceId: 'fedcba9876543210fedcba9876543210',
          observations: [
            { ...savedEvaluation.result.ruleReport.observations[0]!, ruleId: 'WORKFLOW-01' },
          ],
        },
      },
    };
    const view = new HeaeDashboardView({ list: async () => [savedEvaluation, secondEvaluation] });
    await view.ready();

    const selectedState = { ...state, selectedItemIndex: 1 };
    expect(stripAnsi(view.render({ ...selectedState, activeTab: 2 }))).toContain(
      'fedcba9876543210fedcba9876543210',
    );
    const detailState = { ...selectedState, activeTab: 3 };
    expect(stripAnsi(view.render(detailState))).toContain('fedcba9876543210fedcba9876543210');
    expect(allDetailScrollFrames(view, detailState)).toContain(
      'No completed LLM assessment is recorded.',
    );
  });

  it('uses arrows for saved selection but detail scrolling after switching tabs', async () => {
    const secondEvaluation = {
      ...savedEvaluation,
      traceId: 'fedcba9876543210fedcba9876543210',
      result: {
        ...savedEvaluation.result,
        traceId: 'fedcba9876543210fedcba9876543210',
        ruleReport: {
          ...savedEvaluation.result.ruleReport,
          traceId: 'fedcba9876543210fedcba9876543210',
        },
      },
    };
    const view = new HeaeDashboardView({ list: async () => [savedEvaluation, secondEvaluation] });
    const app = new TuiApp('heae', 'cyber', { animate: false });
    app.registerView(view);
    await view.ready();

    app.handleInput('right');
    app.handleInput('down');
    expect(app.getState().selectedItemIndex).toBe(1);

    app.handleInput('right');
    app.handleInput('down');
    app.handleInput('right');
    app.handleInput('down');
    expect(app.getState().selectedItemIndex).toBe(1);
    app.handleInput('right');
    app.handleInput('right');
    app.handleInput('down');
    expect(app.getState().selectedItemIndex).toBe(1);
    app.handleInput('right');
    app.handleInput('down');
    expect(app.getState().selectedItemIndex).toBe(1);
  });

  it('renders persisted evaluation results without inventing metrics', async () => {
    const view = new HeaeDashboardView({
      list: async () => [insufficientEvaluation],
    });

    await view.ready();

    const resultState = {
      ...state,
      activeTab: 6,
      width: 80,
      height: 24,
    };

    const output = stripAnsi(view.render(resultState));

    expect(output).toContain(`Trace ID: ${insufficientEvaluation.traceId}`);
    expect(output).toContain('FAIL');
    expect(output).toContain('Evaluation timestamp: unavailable');

    expect(output).not.toContain('confidence:');
    expect(output).not.toContain('accuracy: 0');

    // Scroll line by line to avoid skipping intermediate sections.
    const scrolled = allDetailScrollFrames(view, resultState);

    expect(scrolled).toContain('Judge status: completed');
    expect(scrolled).toContain('INSUFFICIENT_EVIDENCE');
    expect(scrolled).toContain('Overall uncertainty:');
    expect(scrolled).toContain('Benchmark score: unavailable');
    expect(scrolled).toContain('not proof of root causality');

    // Verify Home/End scrolling at a larger terminal size.
    const wideState = {
      ...state,
      activeTab: 6,
      width: 120,
      height: 40,
    };

    view.handleKey('home', wideState);

    expect(stripAnsi(view.render(wideState))).toContain('Trace ID:');

    view.handleKey('end', wideState);

    expect(stripAnsi(view.render(wideState))).toContain('Comparative results: unavailable');
  });

  it('renders unavailable and skipped result sections explicitly', async () => {
    const unavailable = {
      ...savedEvaluation,
      result: {
        ...savedEvaluation.result,
        judgeStatus: 'unavailable' as const,
        judgment: null,
      },
    };

    const view = new HeaeDashboardView({
      list: async () => [unavailable],
    });

    await view.ready();

    const resultState = {
      ...state,
      activeTab: 6,
    };

    // Collect every visible section without skipping rows.
    const output = allDetailScrollFrames(view, resultState);

    expect(output).toContain('Judge status: unavailable');
    expect(output).toContain('UNAVAILABLE');
    expect(output).toContain('No completed LLM assessment is recorded.');

    expect(output).toContain('UNAVAILABLE METRICS');
    expect(output).toContain('Benchmark score: unavailable');
    expect(output).toContain('not persisted');
  });

  it('renders a persisted completed judgment without upgrading it to causality', async () => {
    const evaluation = insufficientEvaluation;
    expect(evaluation.result.judgeStatus).toBe('completed');
    expect(evaluation.result.judgment.findings[0]?.assessment).toBe('insufficient_evidence');

    const view = new HeaeDashboardView({ list: async () => [evaluation] });
    await view.ready();
    const detailState = { ...state, activeTab: 3 };
    const output = allDetailScrollFrames(view, detailState);

    expect(output).toContain('INSUFFICIENT_EVIDENCE');
    expect(output).toContain('span-1');
    expect(output).toContain('The recorded tool error does not establish its exact cause.');
    expect(output).toContain('More execution context is required.');
    expect(output).toContain('Overall uncertainty:');
    expect(output).toContain('The precise cause remains uncertain.');
    expect(output).toContain('not proof of causality');
    expect(output).not.toContain('Causality proven');
  });

  it('renders graph nodes and relationships from the selected trace', async () => {
    const view = new HeaeDashboardView({
      list: async () => [savedEvaluation],
      loadGraph: async (traceId) => (traceId === graph.traceId ? graph : null),
    });
    await view.ready();

    const graphState = { ...state, activeTab: 4 };
    expect(stripAnsi(view.render(graphState))).toContain('Reading persisted trace graph');
    await view.readyGraph();
    const output = stripAnsi(view.render(graphState));

    expect(output).toContain('3 node(s) · 2 relationship(s)');
    expect(output).toContain('node-task');
    expect(output).toContain('ToolCallNode');
    expect(output).toContain('PARENT_OF');
    expect(output).toContain('CAUSED_BY');
    expect(output).toContain('CAUSED_BY is not verified root causality');
  });

  it('renders actual branches, cycles, and disconnected nodes, with list fallback access', async () => {
    const topologyGraph: TraceGraph = {
      traceId: savedEvaluation.traceId,
      nodes: ['root', 'branch-a', 'branch-b', 'cycle', 'isolated'].map((id) => ({
        id,
        type: 'TaskNode' as const,
        span: {} as TraceGraph['nodes'][number]['span'],
      })),
      edges: [
        { source: 'root', target: 'branch-a', type: 'PARENT_OF' },
        { source: 'root', target: 'branch-b', type: 'PARENT_OF' },
        { source: 'branch-a', target: 'branch-b', type: 'CAUSED_BY' },
        { source: 'cycle', target: 'cycle', type: 'PARENT_OF' },
      ],
      warnings: [],
    };
    const view = new HeaeDashboardView({
      list: async () => [savedEvaluation],
      loadGraph: async () => topologyGraph,
    });
    await view.ready();
    const graphState = { ...state, activeTab: 4 };
    view.render(graphState);
    await view.readyGraph();

    const visualFrames = [stripAnsi(view.render(graphState))];
    for (let index = 0; index < topologyGraph.nodes.length - 1; index += 1) {
      view.handleKey('down', graphState);
      visualFrames.push(stripAnsi(view.render(graphState)));
    }
    const visual = visualFrames.join('\n');
    expect(visual).toContain('root');
    expect(visual).toContain('branch-a');
    expect(visual).toContain('branch-b');
    expect(visual).toContain('isolated');
    expect(visual).toContain('PARENT_OF');
    expect(visual).toContain('CAUSED_BY');
    view.handleKey('end', graphState);

    const bottomFrame = stripAnsi(view.render(graphState));

    expect(bottomFrame).toContain('Legend:');

    view.handleKey('v', graphState);
    view.handleKey('e', graphState);
    for (let index = 0; index < topologyGraph.edges.length; index += 1) {
      view.handleKey('down', graphState);
    }
    const list = stripAnsi(view.render(graphState));
    expect(list).toContain('root -[PARENT_OF]-> branch-a');
    expect(list).toContain('branch-a -[CAUSED_BY]-> branch-b');
    expect(list).toContain('cycle -[PARENT_OF]-> cycle');
  });

  it('scrolls long node and relationship lists without changing evaluation selection', async () => {
    const largeGraph: TraceGraph = {
      ...graph,
      nodes: Array.from({ length: 20 }, (_, index) => ({
        id: `node-${index}`,
        type: 'TaskNode' as const,
        span: {} as TraceGraph['nodes'][number]['span'],
      })),
      edges: Array.from({ length: 19 }, (_, index) => ({
        source: `node-${index}`,
        target: `node-${index + 1}`,
        type: index % 2 === 0 ? ('PARENT_OF' as const) : ('CAUSED_BY' as const),
      })),
    };
    const view = new HeaeDashboardView({
      list: async () => [savedEvaluation],
      loadGraph: async () => largeGraph,
    });
    await view.ready();
    const graphState = { ...state, activeTab: 4 };
    view.render(graphState);
    await view.readyGraph();
    view.render(graphState);

    const frames: string[] = [];
    for (let index = 0; index < 32; index += 1) {
      frames.push(stripAnsi(view.render(graphState)));
      view.handleKey('down', graphState);
    }
    view.handleKey('e', graphState);
    for (let index = 0; index < 32; index += 1) {
      frames.push(stripAnsi(view.render(graphState)));
      view.handleKey('down', graphState);
    }

    expect(frames.join('\n')).toContain('node-19');
    expect(frames.join('\n')).toContain('node-18');
  });

  it('reports clipped visual edges and exposes every edge in list mode', async () => {
    const chain: TraceGraph = {
      traceId: savedEvaluation.traceId,
      nodes: Array.from({ length: 8 }, (_, index) => ({
        id: `chain-${index}`,
        type: 'TaskNode' as const,
        span: {} as TraceGraph['nodes'][number]['span'],
      })),
      edges: Array.from({ length: 7 }, (_, index) => ({
        source: `chain-${index}`,
        target: `chain-${index + 1}`,
        type: index % 2 === 0 ? ('PARENT_OF' as const) : ('CAUSED_BY' as const),
      })),
      warnings: [],
    };
    const view = new HeaeDashboardView({
      list: async () => [savedEvaluation],
      loadGraph: async () => chain,
    });
    await view.ready();
    const graphState = { ...state, activeTab: 4 };
    view.render(graphState);
    await view.readyGraph();

    expect(stripAnsi(view.render(graphState))).toContain('edge(s) are outside this viewport');
    view.handleKey(']', graphState);
    view.handleKey('pagedown', graphState);
    view.handleKey('v', graphState);
    view.handleKey('e', graphState);
    for (let index = 0; index < chain.edges.length; index += 1) {
      view.handleKey('down', graphState);
    }
    const list = stripAnsi(view.render(graphState));
    expect(list).toContain('chain-6 -[PARENT_OF]-> chain-7');
  });

  it('scrolls the visual viewport to the last node at a 120x40 terminal', async () => {
    const verticalGraph: TraceGraph = {
      traceId: savedEvaluation.traceId,
      nodes: Array.from({ length: 7 }, (_, index) => ({
        id: `vertical-${index}`,
        type:
          index === 5
            ? ('ToolCallNode' as const)
            : index === 6
              ? ('OutputNode' as const)
              : ('TaskNode' as const),
        span: {} as TraceGraph['nodes'][number]['span'],
      })),
      edges: [],
      warnings: [],
    };
    const view = new HeaeDashboardView({
      list: async () => [savedEvaluation],
      loadGraph: async () => verticalGraph,
    });
    await view.ready();
    const graphState = { ...state, width: 120, height: 40, activeTab: 4 };
    view.render(graphState);
    await view.readyGraph();

    expect(stripAnsi(view.render(graphState))).toContain('vertical-0');
    view.handleKey('end', graphState);
    expect(stripAnsi(view.render(graphState))).toContain('vertical-6');
    view.handleKey('home', graphState);
    expect(stripAnsi(view.render(graphState))).toContain('vertical-0');

    for (let index = 0; index < 6; index += 1) view.handleKey('down', graphState);
    const selectedOutput = stripAnsi(view.render(graphState));
    expect(selectedOutput).toContain('vertical-6');
    expect(selectedOutput).toContain('OutputNode');
  });

  it('reports missing and unavailable graphs without creating fallback data', async () => {
    const missing = new HeaeDashboardView({
      list: async () => [savedEvaluation],
      loadGraph: async () => null,
    });
    await missing.ready();
    const missingState = { ...state, activeTab: 4 };
    missing.render(missingState);
    await missing.readyGraph();
    expect(stripAnsi(missing.render(missingState))).toContain('No persisted graph is available');

    const unavailable = new HeaeDashboardView({
      list: async () => [savedEvaluation],
      loadGraph: async () => {
        throw new Error('database unavailable');
      },
    });
    await unavailable.ready();
    unavailable.render(missingState);
    await unavailable.readyGraph();
    expect(stripAnsi(unavailable.render(missingState))).toContain('database unavailable');
  });

  it('keeps graph navigation independent from selected evaluation navigation', async () => {
    const secondEvaluation = { ...savedEvaluation, traceId: 'fedcba9876543210fedcba9876543210' };
    const view = new HeaeDashboardView({
      list: async () => [savedEvaluation, secondEvaluation],
      loadGraph: async (traceId) => ({ ...graph, traceId }),
    });
    const app = new TuiApp('heae', 'cyber', { animate: false });
    app.registerView(view);
    await view.ready();

    app.handleInput('right');
    app.handleInput('down');
    expect(app.getState().selectedItemIndex).toBe(1);
    app.handleInput('right');
    app.handleInput('right');
    app.handleInput('right');
    expect(app.getState().activeTab).toBe(4);
    app.handleInput('down');
    expect(app.getState().selectedItemIndex).toBe(1);
  });

  it('reports read-only signal eligibility and the insufficient-evidence skip', async () => {
    const view = new HeaeDashboardView({
      list: async () => [insufficientEvaluation],
      listSignals: async () => [],
    });
    await view.ready();
    const signalState = { ...state, activeTab: 5 };
    view.render(signalState);
    await view.readySignals();
    const output = stripAnsi(view.render(signalState));

    expect(output).toContain('SKIPPED');
    expect(output).toContain('The hypothesis is not supported by the judge.');
    expect(output).toContain('No published OptimizationSignal matches');
    expect(output).not.toContain('eligible');
  });

  it('reports unavailable eligibility when a supported judgment lacks a reviewed proposal', async () => {
    const view = new HeaeDashboardView({
      list: async () => [supportedEvaluation],
      listSignals: async () => [],
    });
    await view.ready();
    const signalState = { ...state, activeTab: 5 };
    view.render(signalState);
    await view.readySignals();

    expect(stripAnsi(view.render(signalState))).toContain('UNAVAILABLE');
    expect(stripAnsi(view.render(signalState))).toContain(
      'No reviewed optimization proposal is persisted',
    );
  });

  it('reports the backend skip reason when no hypothesis matches the judgment', async () => {
    const unsupportedEvaluation = {
      ...insufficientEvaluation,
      result: {
        ...insufficientEvaluation.result,
        judgment: {
          ...insufficientEvaluation.result.judgment,
          findings: [
            {
              ...insufficientEvaluation.result.judgment.findings[0]!,
              category: 'workflow' as const,
              assessment: 'supported' as const,
            },
          ],
        },
      },
    };
    const view = new HeaeDashboardView({
      list: async () => [unsupportedEvaluation],
      listSignals: async () => [],
    });
    await view.ready();
    const signalState = { ...state, activeTab: 5 };
    view.render(signalState);
    await view.readySignals();

    expect(stripAnsi(view.render(signalState))).toContain(
      'The hypothesis is not supported by the judge.',
    );
  });

  it('renders only actual published signal records', async () => {
    const view = new HeaeDashboardView({
      list: async () => [supportedEvaluation],
      listSignals: async () => [publishedSignal],
    });
    await view.ready();
    const signalState = { ...state, activeTab: 5 };
    view.render(signalState);
    await view.readySignals();
    const output = stripAnsi(view.render(signalState));

    expect(output).toContain('ALREADY PUBLISHED');
    expect(output).toContain('sig_saved_tool_01');
    expect(output).toContain('schema: 2.0');
    expect(output).toContain('evidence: span-1');
    expect(output).toContain('failure: tool · confidence: 0.8');
    expect(output).toContain('target: tool · tools.execution');
    expect(output).toContain('action: tool_description_refine');
    expect(output).toContain('Judge provenance: simulated · simulated-test-provider');
    expect(output).not.toContain('timestamp:');
  });

  it('handles published signal loading errors and scrolls long records read-only', async () => {
    const signals = Array.from({ length: 12 }, (_, index) => ({
      ...publishedSignal,
      signal_id: `sig_saved_tool_${index}`,
    }));
    const view = new HeaeDashboardView({
      list: async () => [savedEvaluation],
      listSignals: async () => signals,
    });
    await view.ready();
    const signalState = { ...state, activeTab: 5 };
    view.render(signalState);
    await view.readySignals();
    const frames: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      frames.push(stripAnsi(view.render(signalState)));
      view.handleKey('down', signalState);
    }
    expect(frames.join('\n')).toContain('sig_saved_tool_11');

    const failed = new HeaeDashboardView({
      list: async () => [savedEvaluation],
      listSignals: async () => {
        throw new Error('signal event store unavailable');
      },
    });
    await failed.ready();
    failed.render(signalState);
    await failed.readySignals();
    expect(stripAnsi(failed.render(signalState))).toContain('signal event store unavailable');
  });

  it('scrolls signal records by rendered record height in a short terminal', async () => {
    const signals = Array.from({ length: 12 }, (_, index) => ({
      ...publishedSignal,
      signal_id: `sig_saved_tool_${index}`,
    }));
    const view = new HeaeDashboardView({
      list: async () => [savedEvaluation],
      listSignals: async () => signals,
    });
    await view.ready();
    const signalState = { ...state, width: 100, height: 24, activeTab: 5 };
    view.render(signalState);
    await view.readySignals();

    expect(stripAnsi(view.render(signalState))).toContain('sig_saved_tool_0');
    view.handleKey('down', signalState);
    expect(stripAnsi(view.render(signalState))).toContain('sig_saved_tool_1');
    for (let index = 0; index < 5; index += 1) view.handleKey('down', signalState);
    expect(stripAnsi(view.render(signalState))).toContain('sig_saved_tool_6');
    for (let index = 0; index < 6; index += 1) view.handleKey('down', signalState);
    expect(stripAnsi(view.render(signalState))).toContain('sig_saved_tool_11');
    view.handleKey('up', signalState);
    expect(stripAnsi(view.render(signalState))).toContain('sig_saved_tool_10');
  });
});
