import type { DashboardView, TuiState } from '../types.js';
import {
  ANSI,
  getTheme,
  renderBadge,
  renderBox,
  renderStatusBar,
} from '../../theme/index.js';

export class MainMenuView implements DashboardView {
  id = 'menu';
  name = 'Main Menu';
  title = 'Self-Optimizing LLM Agent · Subsystem Hub';

  render(state: TuiState): string {
    const theme = getTheme(state.theme);
    const width = Math.max(92, Math.min(state.width || 100, 120));

    const menuContent = [
      '',
      `     ${theme.accent}${ANSI.bold}SELF-OPTIMIZING LLM AGENT FOR SE WORKFLOWS${ANSI.reset}`,
      `     ${theme.fgMuted}Central LazyVim-style Navigation Hub · Switch between any module${ANSI.reset}`,
      '',
      `     ${theme.border}───────────────────────────────────────────────────────────────────${ANSI.reset}`,
      '',
      `     ${theme.statusBarKeyBg}${theme.statusBarKeyFg} 1 ${ANSI.reset}  ${theme.fg}${ANSI.bold}Execution Core${ANSI.reset}            ${theme.fgMuted}Deterministic Sandbox & Tool Runner${ANSI.reset}`,
      `     ${theme.statusBarKeyBg}${theme.statusBarKeyFg} 2 ${ANSI.reset}  ${theme.fg}${ANSI.bold}HEAE Evaluation${ANSI.reset}           ${theme.fgMuted}Failure Attribution, Rules & Local Judge${ANSI.reset}`,
      `     ${theme.statusBarKeyBg}${theme.statusBarKeyFg} 3 ${ANSI.reset}  ${theme.fg}${ANSI.bold}Memory Agent${ANSI.reset}              ${theme.fgMuted}Code-grounded Working Memory & Notes${ANSI.reset}`,
      `     ${theme.statusBarKeyBg}${theme.statusBarKeyFg} 4 ${ANSI.reset}  ${theme.fg}${ANSI.bold}Optimization Orchestrator${ANSI.reset} ${theme.fgMuted}6-Axis Config Evolution & Stability${ANSI.reset}`,
      '',
      `     ${theme.border}───────────────────────────────────────────────────────────────────${ANSI.reset}`,
      '',
      `     ${theme.statusBarKeyBg}${theme.statusBarKeyFg} c ${ANSI.reset}  ${theme.fg}Contract Health Check${ANSI.reset}     ${renderBadge('5/5 VALID', 'built', theme)} ${theme.fgMuted}Zod schemas verification${ANSI.reset}`,
      `     ${theme.statusBarKeyBg}${theme.statusBarKeyFg} ? ${ANSI.reset}  ${theme.fg}Help & Keybindings Guide${ANSI.reset}   ${theme.fgMuted}Detailed shortcuts and module reference${ANSI.reset}`,
      `     ${theme.statusBarKeyBg}${theme.statusBarKeyFg} t ${ANSI.reset}  ${theme.fg}Switch Theme${ANSI.reset}              ${renderBadge(theme.name, 'info', theme)} ${theme.fgMuted}(Nord / Catppuccin / Light)${ANSI.reset}`,
      `     ${theme.statusBarKeyBg}${theme.statusBarKeyFg} q ${ANSI.reset}  ${theme.fg}Quit Application${ANSI.reset}          ${theme.fgMuted}Exit interactive terminal${ANSI.reset}`,
      '',
      `     ${theme.fgDim}Tip: Press [Esc] or [m] to return to previous dashboard (${state.previousView ?? 'exec'})${ANSI.reset}`,
      '',
    ];

    const box = renderBox(menuContent, {
      title: 'SOA MODULE SELECTOR (LazyVim Menu)',
      width: Math.min(width, 86),
      rounded: true,
      active: true,
      theme,
    });

    const paddedBox = box
      .split('\n')
      .map((line) => '  ' + line)
      .join('\n');

    const statusBar = renderStatusBar(
      'soa · Main Menu',
      [
        { key: '1-4', label: 'select module' },
        { key: '?', label: 'help' },
        { key: 'esc', label: 'back' },
        { key: 't', label: 'theme' },
        { key: 'q', label: 'quit' },
      ],
      `Active Theme: ${theme.name}`,
      width,
      theme,
    );

    return ['', paddedBox, '', statusBar].join('\n');
  }
}

