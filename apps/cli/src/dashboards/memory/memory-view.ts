import type { DashboardView, TuiState, ViewAction } from '../types.js';
import {
  ANSI,
  getTheme,
  sectionLabel,
  renderPanels,
  renderTopHeader,
  spacer,
  toLines,
  vstack,
  type BadgeVariant,
} from '../../theme/index.js';
import {
  STAGE_CARD_HEIGHT,
  renderControlBar,
  renderMetricList,
  renderStageCard,
} from '../../components/index.js';

interface Stage {
  name: string;
  done: boolean;
  badgeText: string;
  badgeVariant: BadgeVariant;
  desc: string;
  isHeadline?: boolean;
  /** Busy verb shown when the stage is run. */
  verb: string;
  doneMessage: string;
}

const STAGES: Stage[] = [
  {
    done: true,
    name: 'Focus working memory',
    badgeText: 'BUILT',
    badgeVariant: 'built',
    desc: 'start_focus -> explore -> complete_focus. Raw steps are dropped, learned summaries are kept.',
    verb: 'Running focus loop',
    doneMessage: 'Focus loop complete',
  },
  {
    done: true,
    name: 'Note construction',
    badgeText: 'BUILT',
    badgeVariant: 'built',
    desc: 'The small model writes Task / Problem / Cause / Files / Fix / Evidence. Retry once, then a rule-based fallback.',
    verb: 'Building note',
    doneMessage: 'Note built',
  },
  {
    done: true,
    name: 'Linking',
    badgeText: 'BUILT',
    badgeVariant: 'built',
    desc: 'Links related cards by shared keywords, tags and files, same repo only.',
    verb: 'Linking notes',
    doneMessage: 'Notes linked',
  },
  {
    done: true,
    name: 'Code-grounded verification',
    badgeText: 'HEADLINE · BUILT',
    badgeVariant: 'headline',
    desc: 'Fix line in the file + evidence tests at the task commit -> verified / stale / unverifiable / not applicable.',
    isHeadline: true,
    verb: 'Verifying memory',
    doneMessage: 'Verification complete',
  },
  {
    done: false,
    name: 'Reflection scoring',
    badgeText: 'NEXT PHASE',
    badgeVariant: 'phase',
    desc: 'Correctness and freshness from verification, plus relevance, evidence and task contribution.',
    verb: 'Scoring',
    doneMessage: 'Scoring complete',
  },
  {
    done: false,
    name: 'Adaptive retention',
    badgeText: 'NEXT PHASE',
    badgeVariant: 'phase',
    desc: 'KEEP / STRENGTHEN / COMPRESS / DELETE based on status and score.',
    verb: 'Re-checking commit',
    doneMessage: 'Commit re-checked',
  },
];

export class MemoryDashboardView implements DashboardView {
  id = 'memory';
  name = 'Memory Agent';
  title = 'Code-grounded Memory Agent · P. Deepatharshan · IT23190184';
  tabs = ['Pipeline', 'Memories', 'Verify', 'Focus loop', 'Retrieve', 'Decision log'];
  actionLabel = 'run';

  itemCount(): number {
    return STAGES.length;
  }

  activate(state: TuiState): ViewAction {
    const stage = STAGES[state.selectedItemIndex] ?? STAGES[0]!;
    return { type: 'busy', verb: stage.verb, durationMs: 1200, done: stage.doneMessage };
  }

  status(state: TuiState): string {
    const tab = this.tabs[state.activeTab % this.tabs.length] ?? 'Pipeline';
    return `${tab} · 4 of 6 stages built · scoring and retention next`;
  }

  render(state: TuiState): string {
    const theme = getTheme(state.theme);
    const { width, height } = state;
    const selected = state.selectedItemIndex;

    // 1. Header
    const header = renderTopHeader(
      'soa memory',
      this.title,
      'MOCK DATA · real TUI comes after integration',
      theme,
      width,
    );

    // 2. Control row (theme selector + view tabs)
    const controlRow = renderControlBar({
      themeName: state.theme,
      tabs: this.tabs,
      activeTab: state.activeTab,
      theme,
      width,
    });

    // 3. Left panel: stage cards (selected one highlighted and kept in view)
    const buildCards = (innerWidth: number) =>
      STAGES.flatMap((stage, i) =>
        toLines(
          renderStageCard({
            ...stage,
            selected: i === selected,
            width: Math.max(4, innerWidth - 2),
            theme,
          }),
        ).map((line) => ` ${line}`),
      );

    // 4. Right panel: store metrics & repo status
    const buildStore = (innerWidth: number) => {
      const rightWidth = innerWidth + 2;
      const storeMetrics = renderMetricList(
        [
          { badge: 'VERIFIED', variant: 'built', value: 2 },
          { badge: 'STALE', variant: 'warn', value: 2 },
          { badge: 'UNVERIFIABLE', variant: 'warn', value: 1 },
          { badge: 'NOT APPLICABLE', variant: 'info', value: 1 },
        ],
        rightWidth - 6,
        theme,
        { total: 6 },
      );
      return [
        sectionLabel('Store', theme),
        '',
        ...storeMetrics,
        '',
        `  ${theme.fgMuted}memories${' '.repeat(Math.max(1, rightWidth - 18))}6${ANSI.reset}`,
        '',
        `${theme.border}${'─'.repeat(Math.max(0, innerWidth))}${ANSI.reset}`,
        '',
        sectionLabel('Repo status', theme),
        '',
        `  ${theme.badgeBuiltBg}${theme.badgeBuiltFg} ✓ ${ANSI.reset} ${theme.fg}feat/memory-agent-core${ANSI.reset} · ${theme.fgMuted}merged${ANSI.reset}`,
        `  ${theme.fgMuted}  (PR #15)${ANSI.reset}`,
        `  ${theme.accent} • ${ANSI.reset} ${theme.fg}feat/memory-verification${ANSI.reset} · ${theme.badgeWarnBg}${theme.badgeWarnFg} in review ${ANSI.reset}`,
        `  ${theme.fgDim} - scoring, retention · next phase${ANSI.reset}`,
      ];
    };

    const panels = (h: number) =>
      renderPanels(
        {
          title: 'Pipeline',
          active: true,
          build: buildCards,
          focus: [selected * STAGE_CARD_HEIGHT, (selected + 1) * STAGE_CARD_HEIGHT],
        },
        { build: buildStore },
        { width, height: h, ratio: 0.68, theme },
      );

    const gap = spacer(height);
    return vstack(
      [toLines(header), gap, toLines(controlRow), gap, { grow: 1, render: panels }],
      width,
      height,
    ).join('\n');
  }
}
