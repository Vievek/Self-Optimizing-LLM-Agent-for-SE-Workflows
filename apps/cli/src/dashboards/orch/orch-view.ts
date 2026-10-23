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
  visibleLength,
  vstack,
} from '../../theme/index.js';
import { renderControlBar } from '../../components/index.js';

const AXIS_ROWS_START = 2;
const AXIS_COUNT = 6;

export class OrchDashboardView implements DashboardView {
  id = 'orch';
  name = 'Optimization Orchestrator';
  title = 'Optimization Orchestrator · Config Evolution & Stability';
  tabs = ['Live Pipeline', '6-Axes Config', 'Signal Queue', 'Audit Log'];
  actionLabel = 'optimize';

  itemCount(): number {
    return AXIS_COUNT;
  }

  activate(): ViewAction {
    return {
      type: 'busy',
      verb: 'Optimizing config',
      durationMs: 1200,
      done: 'Candidate validated',
    };
  }

  status(state: TuiState): string {
    const tab = this.tabs[state.activeTab % this.tabs.length] ?? 'Live Pipeline';
    return `${tab} · 1 pending signal · 0 rollbacks recorded`;
  }

  render(state: TuiState): string {
    const theme = getTheme(state.theme);
    const { width, height } = state;
    const selected = state.selectedItemIndex;

    // 1. Header
    const header = renderTopHeader(
      'soa orch',
      this.title,
      'ORCHESTRATOR DASHBOARD · continuous learning',
      theme,
      width,
    );

    // 2. Control row
    const configVersion = `${theme.accent}${ANSI.bold}CONFIG SNAPSHOT:${ANSI.reset} ${renderBadge('cfg_0002', 'built', theme)}  ${theme.fgMuted}Stability: Active${ANSI.reset}`;
    const controlRow = renderControlBar({
      themeName: state.theme,
      tabs: this.tabs,
      activeTab: state.activeTab,
      leftBadge: configVersion,
      theme,
      width,
    });

    // 3. Pipeline stages banner (one line when it fits, two otherwise)
    const done = `${theme.badgeBuiltBg}${theme.badgeBuiltFg} ✔ ${ANSI.reset}`;
    const running = `${theme.badgeWarnBg}${theme.badgeWarnFg} ● ${ANSI.reset}`;
    const stages = [
      `${done} Config Seed`,
      `${done} Signal Intake`,
      `${running} Fix Generation`,
      `${done} Validation`,
      `${done} Deploy`,
      `${done} Audit`,
    ];
    const sep = `  ${theme.border}───${ANSI.reset}  `;
    const oneLine = ` ${stages.join(sep)} `;
    const bannerLines =
      visibleLength(oneLine) <= width - 2
        ? [oneLine]
        : [` ${stages.slice(0, 3).join(sep)} `, ` ${stages.slice(3).join(sep)} `];
    const stageBanner = renderBox(bannerLines, { width, style: 'hud', active: true, theme });

    // 4. Left panel: 6-axis table (selected axis highlighted)
    const buildAxes = (innerWidth: number) => {
      const rows = [
        ` ${theme.fg}${ANSI.bold}Axis        Config Path                    Value${ANSI.reset}`,
        ` ${theme.border}────────────────────────────────────────────────────────${ANSI.reset}`,
        ` prompt      prompts.system_prompt_version  1.0`,
        ` tool        tools.apply_patch.description  ${theme.accent}refined${ANSI.reset}`,
        ` planning    planning.backtrack_depth       2`,
        ` workflow    workflow.max_iterations        10`,
        ` retrieval   retrieval.top_k                ${theme.accent}5 -> 7${ANSI.reset}`,
        ` routing     routing.small_tier_threshold   0.40`,
      ];
      const row = AXIS_ROWS_START + selected;
      if (rows[row] !== undefined) rows[row] = highlightRow(rows[row]!, innerWidth, theme);
      return rows;
    };

    // 5. Right panel: candidate mutation & audit log
    const buildCandidate = (innerWidth: number) => [
      sectionLabel('Candidate Mutation (Tool Axis)', theme),
      `  Path: tools.apply_patch.description`,
      `  Old: Apply a unified diff patch.`,
      `  New: Apply a unified diff patch. Paths`,
      `       must be repo-relative.`,
      `  Validation: ${renderBadge('PASS', 'built', theme)} (in range)`,
      '',
      `${theme.border}${'─'.repeat(Math.max(0, innerWidth))}${ANSI.reset}`,
      '',
      sectionLabel('Audit Log', theme),
      `  store/logs/orch-audit.jsonl`,
      `  cfg(tool): sig_20261015T1000_django_01`,
    ];

    const panels = (h: number) =>
      renderPanels(
        {
          title: 'Current 6-Axis Configuration (cfg_0002)',
          active: true,
          build: buildAxes,
          focus: [AXIS_ROWS_START + selected, AXIS_ROWS_START + selected + 1],
        },
        { title: 'Candidate Mutation & Deploy', build: buildCandidate },
        { width, height: h, ratio: 0.55, theme },
      );

    const gap = spacer(height);
    return vstack(
      [
        toLines(header),
        gap,
        toLines(controlRow),
        gap,
        toLines(stageBanner),
        gap,
        { grow: 1, render: panels },
      ],
      width,
      height,
    ).join('\n');
  }
}
