import type { DashboardView, TuiState } from '../types.js';
import {
  ANSI,
  getTheme,
  renderBox,
  renderStatusBar,
  renderTopHeader,
} from '../../theme/index.js';
import {
  renderControlBar,
  renderMetricList,
  renderSplitLayout,
  renderStageCard,
} from '../../components/index.js';

export class MemoryDashboardView implements DashboardView {
  id = 'memory';
  name = 'Memory Agent';
  title = 'Code-grounded Memory Agent · P. Deepatharshan · IT23190184';
  tabs = ['Pipeline', 'Memories', 'Verify', 'Focus loop', 'Retrieve', 'Decision log'];

  render(state: TuiState): string {
    const theme = getTheme(state.theme);
    const availableWidth = state.width ? state.width - 4 : 100;
    const width = Math.max(92, Math.min(availableWidth, 140));

    // 1. Header
    const header = renderTopHeader(
      'soa memory',
      this.title,
      'MOCK DATA · real TUI comes after integration',
      theme,
      width,
    );

    // 2. Control Row (Theme selector + View tabs)
    const controlRow = renderControlBar({
      themeName: state.theme,
      tabs: this.tabs,
      activeTab: state.activeTab,
      theme,
    });

    // 3. Left Column: Standardized Stage Cards
    const leftWidth = Math.floor(width * 0.68);
    const rightWidth = width - leftWidth - 3;
    const cardWidth = leftWidth - 4;

    const stageCards = [
      renderStageCard({
        done: true,
        name: 'Focus working memory',
        badgeText: 'BUILT',
        badgeVariant: 'built',
        desc: 'start_focus -> explore -> complete_focus. Raw steps are dropped, learned summaries are kept.',
        width: cardWidth,
        theme,
      }),
      renderStageCard({
        done: true,
        name: 'Note construction',
        badgeText: 'BUILT',
        badgeVariant: 'built',
        desc: 'The small model writes Task / Problem / Cause / Files / Fix / Evidence. Retry once, then a rule-based fallback.',
        width: cardWidth,
        theme,
      }),
      renderStageCard({
        done: true,
        name: 'Linking',
        badgeText: 'BUILT',
        badgeVariant: 'built',
        desc: 'Links related cards by shared keywords, tags and files, same repo only.',
        width: cardWidth,
        theme,
      }),
      renderStageCard({
        done: true,
        name: 'Code-grounded verification',
        badgeText: 'HEADLINE · BUILT',
        badgeVariant: 'headline',
        desc: 'Fix line in the file + evidence tests at the task commit -> verified / stale / unverifiable / not applicable.',
        isHeadline: true,
        width: cardWidth,
        theme,
      }),
      renderStageCard({
        done: false,
        name: 'Reflection scoring',
        badgeText: 'NEXT PHASE',
        badgeVariant: 'phase',
        desc: 'Correctness and freshness from verification, plus relevance, evidence and task contribution.',
        width: cardWidth,
        theme,
      }),
      renderStageCard({
        done: false,
        name: 'Adaptive retention',
        badgeText: 'NEXT PHASE',
        badgeVariant: 'phase',
        desc: 'KEEP / STRENGTHEN / COMPRESS / DELETE based on status and score.',
        width: cardWidth,
        theme,
      }),
    ];

    const leftBox = renderBox(stageCards.join('\n').split('\n'), {
      title: 'Pipeline',
      width: leftWidth,
      rounded: true,
      theme,
    });

    // 4. Right Column: Store Metrics & Repo Status
    const storeMetrics = renderMetricList(
      [
        { badge: 'VERIFIED', variant: 'built', value: 2 },
        { badge: 'STALE', variant: 'warn', value: 2 },
        { badge: 'UNVERIFIABLE', variant: 'warn', value: 1 },
        { badge: 'NOT APPLICABLE', variant: 'info', value: 1 },
      ],
      rightWidth - 6,
      theme,
    );

    const rightContent = [
      `${theme.accent}${ANSI.bold}Store${ANSI.reset}`,
      '',
      ...storeMetrics,
      '',
      `  ${theme.fgMuted}memories${' '.repeat(Math.max(1, rightWidth - 18))}6${ANSI.reset}`,
      '',
      `${theme.border}${'─'.repeat(Math.max(20, rightWidth - 4))}${ANSI.reset}`,
      '',
      `${theme.accent}${ANSI.bold}Repo status${ANSI.reset}`,
      '',
      `  ${theme.badgeBuiltBg} ✓ ${ANSI.reset} ${theme.fg}feat/memory-agent-core${ANSI.reset} · ${theme.fgMuted}merged${ANSI.reset}`,
      `  ${theme.fgMuted}  (PR #15)${ANSI.reset}`,
      `  ${theme.accent} • ${ANSI.reset} ${theme.fg}feat/memory-verification${ANSI.reset} · ${theme.badgeWarnBg} in review ${ANSI.reset}`,
      `  ${theme.fgDim} - scoring, retention · next phase${ANSI.reset}`,
    ];

    const rightBox = renderBox(rightContent, {
      width: rightWidth,
      rounded: true,
      theme,
    });

    // 5. Two-column Responsive Split Layout (Reused Component)
    const body = renderSplitLayout(leftBox, rightBox, {
      width,
      ratio: 0.68,
      gap: 3,
      theme,
    });

    // 6. Bottom Status Bar
    const activeTabIdx = state.activeTab % this.tabs.length;
    const activeTabName = this.tabs[activeTabIdx] ?? 'Pipeline';
    const statusBar = renderStatusBar(
      `soa memory · ${activeTabName}`,
      [
        { key: 'tab', label: 'views' },
        { key: '↵', label: 'run' },
        { key: 'm', label: 'menu' },
        { key: '?', label: 'help' },
        { key: 't', label: 'theme' },
        { key: 'q', label: 'quit' },
      ],
      '4 of 6 stages built · scoring and retention next',
      width,
      theme,
    );

    return [header, '', controlRow, '', body, '', statusBar].join('\n');
  }
}
