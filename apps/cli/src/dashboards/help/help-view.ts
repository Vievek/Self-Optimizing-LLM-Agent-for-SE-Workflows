import type { DashboardView, TuiState } from '../types.js';
import {
  ANSI,
  getTheme,
  sectionLabel,
  renderBadge,
  renderKey,
  renderPanel,
  renderTopHeader,
  spacer,
  toLines,
  vstack,
  type ThemeColors,
} from '../../theme/index.js';

function helpLines(theme: ThemeColors): string[] {
  const key = (k: string) => renderKey(k, theme);
  const rule = ` ${theme.border}${'─'.repeat(75)}${ANSI.reset}`;
  return [
    ` ${sectionLabel('GLOBAL NAVIGATION SHORTCUTS', theme)}`,
    rule,
    `   ${key('m')} or ${key('Space')}   Toggle LazyVim-style Central Main Menu`,
    `   ${key('1')}             Jump to Execution Core Dashboard (Default Agent Workspace)`,
    `   ${key('2')}             Jump to HEAE Evaluation & Failure Attribution Dashboard`,
    `   ${key('3')}             Jump to Memory Agent Dashboard (Notes & Verification)`,
    `   ${key('4')}             Jump to Optimization Orchestrator Dashboard (6-Axes Config)`,
    `   ${key('?')} or ${key('h')}       Toggle this Help & Keybindings Guide`,
    `   ${key('Esc')}           Return to previous dashboard view`,
    `   ${key('q')} or ${key('Ctrl+C')}  Quit application cleanly`,
    '',
    ` ${sectionLabel('VIEW & STYLING CONTROLS', theme)}`,
    rule,
    `   ${key('Tab')}           Cycle through view tabs inside the current dashboard`,
    `   ${key('t')}             Cycle active theme: ${renderBadge('Cyber', 'info', theme)} -> ${renderBadge('Nord', 'built', theme)} -> ${renderBadge('Catppuccin', 'headline', theme)} -> ${renderBadge('Light', 'warn', theme)}`,
    `   ${key('↵ Enter')}       Execute active task / run pipeline stage`,
    '',
    ` ${sectionLabel('SUBSYSTEM ROLES & ARCHITECTURE', theme)}`,
    rule,
    `   ${theme.fg}${ANSI.bold}Execution Core [1]:${ANSI.reset}       Runs agent tasks, coordinates tools, and outputs OTel traces`,
    `   ${theme.fg}${ANSI.bold}HEAE [2]:${ANSI.reset}                 Constructs Kùzu trace graphs, runs failure rules, and emits signals`,
    `   ${theme.fg}${ANSI.bold}Memory Agent [3]:${ANSI.reset}         Maintains code-grounded working memory notes & verified facts`,
    `   ${theme.fg}${ANSI.bold}Orchestrator [4]:${ANSI.reset}         Applies signals to 6 config axes, snapshotting git versions`,
  ];
}

const HEADER_LINES = 2;

export class HelpDashboardView implements DashboardView {
  id = 'help';
  name = 'Help & Keybindings';
  title = 'Self-Optimizing Agent TUI · Quick Reference Guide';

  /** Height of the help box for a given body height. */
  private boxHeight(height: number): number {
    return height - HEADER_LINES - spacer(height).length;
  }

  /** Up / down scroll the guide: one "item" per scroll position. */
  itemCount(state: TuiState): number {
    const visible = this.boxHeight(state.height) - 2;
    return Math.max(1, helpLines(getTheme(state.theme)).length - visible + 1);
  }

  status(state: TuiState): string {
    return `Help Guide · Press [Esc] to return to ${state.previousView ?? 'exec'}`;
  }

  render(state: TuiState): string {
    const theme = getTheme(state.theme);
    const { width, height } = state;

    const header = renderTopHeader('soa help', this.title, 'HELP & NAVIGATION GUIDE', theme, width);
    const box = (h: number) =>
      renderPanel(
        {
          title: 'KEYBINDINGS & SYSTEM OVERVIEW',
          active: true,
          build: () => helpLines(theme),
          scrollOffset: state.selectedItemIndex,
        },
        width,
        h,
        theme,
      );

    return vstack([toLines(header), spacer(height), { grow: 1, render: box }], width, height).join(
      '\n',
    );
  }
}
