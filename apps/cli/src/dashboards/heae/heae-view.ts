import type { DashboardView, TuiState } from '../types.js';
import {
  ANSI,
  getTheme,
  renderBadge,
  renderBox,
  renderStatusBar,
  renderTopHeader,
} from '../../theme/index.js';
import {
  renderControlBar,
  renderSplitLayout,
} from '../../components/index.js';

export class HeaeDashboardView implements DashboardView {
  id = 'heae';
  name = 'HEAE Evaluation';
  title = 'HEAE Evaluation · Hierarchical Attribution Engine';
  tabs = ['Attribution', 'Rule Engine', 'Trace Graph', 'Signals'];

  render(state: TuiState): string {
    const theme = getTheme(state.theme);
    const availableWidth = state.width ? state.width - 4 : 100;
    const width = Math.max(92, Math.min(availableWidth, 140));

    // 1. Header
    const header = renderTopHeader(
      'soa heae',
      this.title,
      'EVALUATION ENGINE · rules & local judge',
      theme,
      width,
    );

    // 2. Control Row
    const judgeBadge = `${theme.accent}${ANSI.bold}JUDGE MODE:${ANSI.reset} ${renderBadge('Deterministic Rules (Offline)', 'built', theme)}  ${theme.fgMuted}Ollama Qwen-3B Ready${ANSI.reset}`;
    const controlRow = renderControlBar({
      themeName: state.theme,
      tabs: this.tabs,
      activeTab: state.activeTab,
      leftBadge: judgeBadge,
      theme,
    });

    // 3. Layout: Left Box (Attributed Hypotheses), Right Box (Kùzu DB & Graph Metrics)
    const leftWidth = Math.floor(width * 0.65);
    const rightWidth = width - leftWidth - 3;

    const hypotheses = [
      renderBox(
        [
          ` ${theme.badgeBuiltBg} ✔ ${ANSI.reset} ${theme.fg}${ANSI.bold}Rule TOOL-02: Patch Apply Context Mismatch${ANSI.reset}  ${renderBadge('TOOL FAILURE', 'error', theme)}`,
          `   ${theme.fgMuted}Target Span: span_tool_003 (apply_patch) -> Exit 1 (context offset mismatch)${ANSI.reset}`,
          `   ${theme.fgMuted}Confidence: 0.92 · Suggested Action: tool_description_refine${ANSI.reset}`,
        ],
        {
          width: leftWidth - 4,
          rounded: true,
          theme,
        },
      ),
      renderBox(
        [
          ` ${theme.badgeBuiltBg} ✔ ${ANSI.reset} ${theme.fg}${ANSI.bold}Rule WORKFLOW-01: Unverified Code Mutation${ANSI.reset}  ${renderBadge('WORKFLOW', 'warn', theme)}`,
          `   ${theme.fgMuted}Observed: edit_file succeeded but run_tests was never invoked before task completion${ANSI.reset}`,
          `   ${theme.fgMuted}Confidence: 0.88 · Suggested Action: workflow_verification_enforce${ANSI.reset}`,
        ],
        {
          width: leftWidth - 4,
          rounded: true,
          theme,
        },
      ),
      renderBox(
        [
          ` ${theme.fgDim} [ ] ${ANSI.reset} ${theme.fg}${ANSI.bold}Rule RETRIEVAL-01: Zero Context Yield${ANSI.reset}  ${renderBadge('PASS', 'built', theme)}`,
          `   ${theme.fgMuted}All 3 retrieval spans yielded valid files with depth <= 3${ANSI.reset}`,
        ],
        {
          width: leftWidth - 4,
          rounded: true,
          theme,
        },
      ),
    ];

    const leftBox = renderBox(hypotheses.join('\n').split('\n'), {
      title: 'Attributed Diagnostics & Failure Rules',
      width: leftWidth,
      rounded: true,
      active: true,
      theme,
    });

    // Right Box: Kùzu Graph DB stats & Contracts Status
    const graphStats = [
      `${theme.accent}${ANSI.bold}Kùzu Graph Store${ANSI.reset}`,
      `  Path: store/graphs/heae.kuzu`,
      '',
      `  PromptNode:        ${theme.fg}3${ANSI.reset}`,
      `  PlanNode:          ${theme.fg}5${ANSI.reset}`,
      `  ToolCallNode:      ${theme.fg}8${ANSI.reset}`,
      `  RetrievalNode:     ${theme.fg}2${ANSI.reset}`,
      `  OutputNode:        ${theme.fg}1${ANSI.reset}`,
      '',
      `${theme.border}${'─'.repeat(Math.max(20, rightWidth - 4))}${ANSI.reset}`,
      '',
      `${theme.accent}${ANSI.bold}Generated Contracts${ANSI.reset}`,
      '',
      `  ${renderBadge('OutcomeEvidence', 'built', theme)}   v2.0 -> Memory`,
      `  ${renderBadge('OptimizationSignal', 'built', theme)} v2.0 -> Orch`,
      '',
      `  ${theme.fgDim}SHA-256 Fingerprint: verified${ANSI.reset}`,
    ];

    const rightBox = renderBox(graphStats, {
      title: 'Graph & Contracts',
      width: rightWidth,
      rounded: true,
      theme,
    });

    // 4. Two-column Responsive Split Layout (Reused Component)
    const body = renderSplitLayout(leftBox, rightBox, {
      width,
      ratio: 0.65,
      gap: 3,
      theme,
    });

    // 5. Status Bar
    const activeTabIdx = state.activeTab % this.tabs.length;
    const activeTabName = this.tabs[activeTabIdx] ?? 'Attribution';
    const statusBar = renderStatusBar(
      `soa heae · ${activeTabName}`,
      [
        { key: 'm', label: 'menu' },
        { key: 'tab', label: 'views' },
        { key: '↵', label: 'evaluate' },
        { key: '?', label: 'help' },
        { key: 't', label: 'theme' },
        { key: 'q', label: 'quit' },
      ],
      '2 active hypotheses · 0 duplicate publications',
      width,
      theme,
    );

    return [header, '', controlRow, '', body, '', statusBar].join('\n');
  }
}
