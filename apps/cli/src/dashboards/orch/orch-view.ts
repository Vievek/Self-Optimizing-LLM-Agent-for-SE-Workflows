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

export class OrchDashboardView implements DashboardView {
  id = 'orch';
  name = 'Optimization Orchestrator';
  title = 'Optimization Orchestrator · Config Evolution & Stability';
  tabs = ['Live Pipeline', '6-Axes Config', 'Signal Queue', 'Audit Log'];

  render(state: TuiState): string {
    const theme = getTheme(state.theme);
    const availableWidth = state.width ? state.width - 4 : 100;
    const width = Math.max(92, Math.min(availableWidth, 140));

    // 1. Header
    const header = renderTopHeader(
      'soa orch',
      this.title,
      'ORCHESTRATOR DASHBOARD · continuous learning',
      theme,
      width,
    );

    // 2. Control Row
    const configVersion = `${theme.accent}${ANSI.bold}CONFIG SNAPSHOT:${ANSI.reset} ${renderBadge('cfg_0002', 'built', theme)}  ${theme.fgMuted}Stability: Active${ANSI.reset}`;
    const controlRow = renderControlBar({
      themeName: state.theme,
      tabs: this.tabs,
      activeTab: state.activeTab,
      leftBadge: configVersion,
      theme,
    });

    // 3. Pipeline Stages Banner
    const stages = [
      `${theme.badgeBuiltBg} ✔ ${ANSI.reset} Config Seed`,
      `${theme.badgeBuiltBg} ✔ ${ANSI.reset} Signal Intake`,
      `${theme.badgeWarnBg} ● ${ANSI.reset} Fix Generation`,
      `${theme.badgeBuiltBg} ✔ ${ANSI.reset} Validation`,
      `${theme.badgeBuiltBg} ✔ ${ANSI.reset} Deploy`,
      `${theme.badgeBuiltBg} ✔ ${ANSI.reset} Audit`,
    ];
    const stageBanner = renderBox([` ${stages.join('  ───  ')} `], {
      width,
      rounded: true,
      active: true,
      theme,
    });

    // 4. Two columns: 6-Axes table on left, Candidate & Audit on right
    const leftWidth = Math.floor(width * 0.55);
    const rightWidth = width - leftWidth - 3;

    const axesLines = [
      ` ${theme.fg}${ANSI.bold}Axis        Config Path                    Value${ANSI.reset}`,
      ` ${theme.border}────────────────────────────────────────────────────────${ANSI.reset}`,
      ` prompt      prompts.system_prompt_version  1.0`,
      ` tool        tools.apply_patch.description  ${theme.accent}refined${ANSI.reset}`,
      ` planning    planning.backtrack_depth       2`,
      ` workflow    workflow.max_iterations        10`,
      ` retrieval   retrieval.top_k                ${theme.accent}5 -> 7${ANSI.reset}`,
      ` routing     routing.small_tier_threshold   0.40`,
    ];

    const leftBox = renderBox(axesLines, {
      title: 'Current 6-Axis Configuration (cfg_0002)',
      width: leftWidth,
      rounded: true,
      theme,
    });

    const candidateLines = [
      `${theme.accent}${ANSI.bold}Candidate Mutation (Tool Axis)${ANSI.reset}`,
      `  Path: tools.apply_patch.description`,
      `  Old: Apply a unified diff patch.`,
      `  New: Apply a unified diff patch. Paths`,
      `       must be repo-relative.`,
      `  Validation: ${renderBadge('PASS', 'built', theme)} (in range)`,
      '',
      `${theme.border}${'─'.repeat(Math.max(20, rightWidth - 4))}${ANSI.reset}`,
      '',
      `${theme.accent}${ANSI.bold}Audit Log${ANSI.reset}`,
      `  store/logs/orch-audit.jsonl`,
      `  cfg(tool): sig_20261015T1000_django_01`,
    ];

    const rightBox = renderBox(candidateLines, {
      title: 'Candidate Mutation & Deploy',
      width: rightWidth,
      rounded: true,
      theme,
    });

    // 5. Two-column Responsive Split Layout (Reused Component)
    const body = renderSplitLayout(leftBox, rightBox, {
      width,
      ratio: 0.55,
      gap: 3,
      theme,
    });

    // 6. Status Bar
    const activeTabIdx = state.activeTab % this.tabs.length;
    const activeTabName = this.tabs[activeTabIdx] ?? 'Live Pipeline';
    const statusBar = renderStatusBar(
      `soa orch · ${activeTabName}`,
      [
        { key: 'm', label: 'menu' },
        { key: 'tab', label: 'views' },
        { key: '↵', label: 'optimize' },
        { key: '?', label: 'help' },
        { key: 't', label: 'theme' },
        { key: 'q', label: 'quit' },
      ],
      '1 pending signal · 0 rollbacks recorded',
      width,
      theme,
    );

    return [header, '', controlRow, '', stageBanner, '', body, '', statusBar].join('\n');
  }
}
