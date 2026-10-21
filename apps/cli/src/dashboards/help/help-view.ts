import type { DashboardView, TuiState } from '../types.js';
import {
  ANSI,
  getTheme,
  renderBadge,
  renderBox,
  renderStatusBar,
  renderTopHeader,
} from '../../theme/index.js';

export class HelpDashboardView implements DashboardView {
  id = 'help';
  name = 'Help & Keybindings';
  title = 'Self-Optimizing Agent TUI · Quick Reference Guide';

  render(state: TuiState): string {
    const theme = getTheme(state.theme);
    const width = Math.max(90, Math.min(state.width || 100, 114));

    const header = renderTopHeader(
      'soa help',
      this.title,
      'HELP & NAVIGATION GUIDE',
      theme,
      width,
    );

    const keybindings = [
      ` ${theme.accent}${ANSI.bold}GLOBAL NAVIGATION SHORTCUTS${ANSI.reset}`,
      ` ${theme.border}───────────────────────────────────────────────────────────────────────────${ANSI.reset}`,
      `   ${theme.statusBarKeyBg}${theme.statusBarKeyFg} m ${ANSI.reset} or ${theme.statusBarKeyBg}${theme.statusBarKeyFg} Space ${ANSI.reset}   Toggle LazyVim-style Central Main Menu`,
      `   ${theme.statusBarKeyBg}${theme.statusBarKeyFg} 1 ${ANSI.reset}             Jump to Execution Core Dashboard (Default Agent Workspace)`,
      `   ${theme.statusBarKeyBg}${theme.statusBarKeyFg} 2 ${ANSI.reset}             Jump to HEAE Evaluation & Failure Attribution Dashboard`,
      `   ${theme.statusBarKeyBg}${theme.statusBarKeyFg} 3 ${ANSI.reset}             Jump to Memory Agent Dashboard (Notes & Verification)`,
      `   ${theme.statusBarKeyBg}${theme.statusBarKeyFg} 4 ${ANSI.reset}             Jump to Optimization Orchestrator Dashboard (6-Axes Config)`,
      `   ${theme.statusBarKeyBg}${theme.statusBarKeyFg} ? ${ANSI.reset} or ${theme.statusBarKeyBg}${theme.statusBarKeyFg} h ${ANSI.reset}       Toggle this Help & Keybindings Guide`,
      `   ${theme.statusBarKeyBg}${theme.statusBarKeyFg} Esc ${ANSI.reset}           Return to previous dashboard view`,
      `   ${theme.statusBarKeyBg}${theme.statusBarKeyFg} q ${ANSI.reset} or ${theme.statusBarKeyBg}${theme.statusBarKeyFg} Ctrl+C ${ANSI.reset}  Quit application cleanly`,
      '',
      ` ${theme.accent}${ANSI.bold}VIEW & STYLING CONTROLS${ANSI.reset}`,
      ` ${theme.border}───────────────────────────────────────────────────────────────────────────${ANSI.reset}`,
      `   ${theme.statusBarKeyBg}${theme.statusBarKeyFg} Tab ${ANSI.reset}           Cycle through view tabs inside the current dashboard`,
      `   ${theme.statusBarKeyBg}${theme.statusBarKeyFg} t ${ANSI.reset}             Cycle active theme: ${renderBadge('Nord', 'built', theme)} -> ${renderBadge('Catppuccin', 'headline', theme)} -> ${renderBadge('Light', 'warn', theme)}`,
      `   ${theme.statusBarKeyBg}${theme.statusBarKeyFg} ↵ Enter ${ANSI.reset}       Execute active task / run pipeline stage`,
      '',
      ` ${theme.accent}${ANSI.bold}SUBSYSTEM ROLES & ARCHITECTURE${ANSI.reset}`,
      ` ${theme.border}───────────────────────────────────────────────────────────────────────────${ANSI.reset}`,
      `   ${theme.fg}${ANSI.bold}Execution Core [1]:${ANSI.reset}       Runs agent tasks, coordinates tools, and outputs OTel traces`,
      `   ${theme.fg}${ANSI.bold}HEAE [2]:${ANSI.reset}                 Constructs Kùzu trace graphs, runs failure rules, and emits signals`,
      `   ${theme.fg}${ANSI.bold}Memory Agent [3]:${ANSI.reset}         Maintains code-grounded working memory notes & verified facts`,
      `   ${theme.fg}${ANSI.bold}Orchestrator [4]:${ANSI.reset}         Applies signals to 6 config axes, snapshotting git versions`,
    ];

    const box = renderBox(keybindings, {
      title: 'KEYBINDINGS & SYSTEM OVERVIEW',
      width,
      rounded: true,
      active: true,
      theme,
    });

    const statusBar = renderStatusBar(
      'soa · Help Guide',
      [
        { key: 'esc', label: 'back' },
        { key: '1-4', label: 'modules' },
        { key: 't', label: 'theme' },
        { key: 'q', label: 'quit' },
      ],
      `Press [Esc] to return to ${state.previousView ?? 'exec'}`,
      width,
      theme,
    );

    return [header, '', box, '', statusBar].join('\n');
  }
}

