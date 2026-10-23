import type { DashboardView, TuiState, ViewAction } from '../types.js';
import {
  ANSI,
  getTheme,
  sectionLabel,
  highlightRow,
  renderBadge,
  renderBox,
  renderPanels,
  renderTopHeader,
  spacer,
  toLines,
  vstack,
  type ThemeColors,
} from '../../theme/index.js';
import { renderControlBar } from '../../components/index.js';

/** The attributed failure rules, one box each. */
function hypothesisLines(theme: ThemeColors): string[][] {
  return [
    [
      ` ${theme.badgeBuiltBg}${theme.badgeBuiltFg} ✔ ${ANSI.reset} ${theme.fg}${ANSI.bold}Rule TOOL-02: Patch Apply Context Mismatch${ANSI.reset}  ${renderBadge('TOOL FAILURE', 'error', theme)}`,
      `   ${theme.fgMuted}Target Span: span_tool_003 (apply_patch) -> Exit 1 (context offset mismatch)${ANSI.reset}`,
      `   ${theme.fgMuted}Confidence: 0.92 · Suggested Action: tool_description_refine${ANSI.reset}`,
    ],
    [
      ` ${theme.badgeBuiltBg}${theme.badgeBuiltFg} ✔ ${ANSI.reset} ${theme.fg}${ANSI.bold}Rule WORKFLOW-01: Unverified Code Mutation${ANSI.reset}  ${renderBadge('WORKFLOW', 'warn', theme)}`,
      `   ${theme.fgMuted}Observed: edit_file succeeded but run_tests was never invoked before task completion${ANSI.reset}`,
      `   ${theme.fgMuted}Confidence: 0.88 · Suggested Action: workflow_verification_enforce${ANSI.reset}`,
    ],
    [
      ` ${theme.fgDim} [ ] ${ANSI.reset} ${theme.fg}${ANSI.bold}Rule RETRIEVAL-01: Zero Context Yield${ANSI.reset}  ${renderBadge('PASS', 'built', theme)}`,
      `   ${theme.fgMuted}All 3 retrieval spans yielded valid files with depth <= 3${ANSI.reset}`,
    ],
  ];
}

export class HeaeDashboardView implements DashboardView {
  id = 'heae';
  name = 'HEAE Evaluation';
  title = 'HEAE Evaluation · Hierarchical Attribution Engine';
  tabs = ['Attribution', 'Rule Engine', 'Trace Graph', 'Signals'];
  actionLabel = 'evaluate';

  itemCount(): number {
    return 3;
  }

  activate(): ViewAction {
    return { type: 'busy', verb: 'Scoring', durationMs: 1100, done: 'Evaluation complete' };
  }

  status(state: TuiState): string {
    const tab = this.tabs[state.activeTab % this.tabs.length] ?? 'Attribution';
    return `${tab} · 2 active hypotheses · 0 duplicate publications`;
  }

  render(state: TuiState): string {
    const theme = getTheme(state.theme);
    const { width, height } = state;
    const selected = state.selectedItemIndex;

    // 1. Header
    const header = renderTopHeader(
      'soa heae',
      this.title,
      'EVALUATION ENGINE · rules & local judge',
      theme,
      width,
    );

    // 2. Control row
    const judgeBadge = `${theme.accent}${ANSI.bold}JUDGE MODE:${ANSI.reset} ${renderBadge('Deterministic Rules (Offline)', 'built', theme)}  ${theme.fgMuted}Ollama Qwen-3B Ready${ANSI.reset}`;
    const controlRow = renderControlBar({
      themeName: state.theme,
      tabs: this.tabs,
      activeTab: state.activeTab,
      leftBadge: judgeBadge,
      theme,
      width,
    });

    // 3. Left panel: attributed hypotheses (selected one highlighted)
    const hypotheses = hypothesisLines(theme);
    const boxHeights = hypotheses.map((lines) => lines.length + 2);
    const focusStart = boxHeights.slice(0, selected).reduce((a, b) => a + b, 0);

    const buildHypotheses = (innerWidth: number) => {
      const boxWidth = Math.max(4, innerWidth - 2);
      return hypotheses.flatMap((lines, i) => {
        const isSelected = i === selected;
        const content = isSelected
          ? [highlightRow(lines[0]!, boxWidth - 2, theme), ...lines.slice(1)]
          : lines;
        return toLines(
          renderBox(content, { width: boxWidth, rounded: true, active: isSelected, theme }),
        ).map((line) => ` ${line}`);
      });
    };

    // 4. Right panel: Kùzu graph stats & contract status
    const buildGraph = (innerWidth: number) => [
      sectionLabel('Kùzu Graph Store', theme),
      `  Path: store/graphs/heae.kuzu`,
      '',
      `  PromptNode:        ${theme.fg}3${ANSI.reset}`,
      `  PlanNode:          ${theme.fg}5${ANSI.reset}`,
      `  ToolCallNode:      ${theme.fg}8${ANSI.reset}`,
      `  RetrievalNode:     ${theme.fg}2${ANSI.reset}`,
      `  OutputNode:        ${theme.fg}1${ANSI.reset}`,
      '',
      `${theme.border}${'─'.repeat(Math.max(0, innerWidth))}${ANSI.reset}`,
      '',
      sectionLabel('Generated Contracts', theme),
      '',
      `  ${renderBadge('OutcomeEvidence', 'built', theme)}   v2.0 -> Memory`,
      `  ${renderBadge('OptimizationSignal', 'built', theme)} v2.0 -> Orch`,
      '',
      `  ${theme.fgDim}SHA-256 Fingerprint: verified${ANSI.reset}`,
    ];

    const panels = (h: number) =>
      renderPanels(
        {
          title: 'Attributed Diagnostics & Failure Rules',
          active: true,
          build: buildHypotheses,
          focus: [focusStart, focusStart + (boxHeights[selected] ?? 0)],
        },
        { title: 'Graph & Contracts', build: buildGraph },
        { width, height: h, ratio: 0.65, theme },
      );

    const gap = spacer(height);
    return vstack(
      [toLines(header), gap, toLines(controlRow), gap, { grow: 1, render: panels }],
      width,
      height,
    ).join('\n');
  }
}
