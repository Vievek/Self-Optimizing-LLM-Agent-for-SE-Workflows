import type { DashboardView, TuiState, ViewAction } from '../types.js';
import {
  ANSI,
  centerBlock,
  getTheme,
  highlightRow,
  renderBadge,
  renderKey,
  renderPanel,
  visibleLength,
} from '../../theme/index.js';
import { renderBlockTitle } from '../../components/block-title.js';
import { BOOT_SUBTITLE } from '../../components/boot-sequence.js';
import { runContractHealthCheck, summarizeContractHealth } from '../../contract-health.js';

/** Selectable menu rows: the content line they sit on and the key they trigger. */
const MENU_ITEMS = [
  { line: 6, key: '1' },
  { line: 7, key: '2' },
  { line: 8, key: '3' },
  { line: 9, key: '4' },
  { line: 13, key: 'c' },
  { line: 14, key: '?' },
  { line: 15, key: 't' },
  { line: 16, key: 'q' },
];

export class MainMenuView implements DashboardView {
  id = 'menu';
  name = 'Main Menu';
  title = 'Self-Optimizing LLM Agent · Subsystem Hub';
  actionLabel = 'open';

  itemCount(): number {
    return MENU_ITEMS.length;
  }

  activate(state: TuiState): ViewAction {
    const item = MENU_ITEMS[state.selectedItemIndex] ?? MENU_ITEMS[0]!;
    if (item.key === 'c') {
      return {
        type: 'busy',
        verb: 'Checking contracts',
        durationMs: 1000,
        done: `Contracts ${summarizeContractHealth(runContractHealthCheck())}`,
      };
    }
    return { type: 'key', key: item.key };
  }

  status(): string {
    return `Main Menu · Active Theme: ${getTheme().name}`;
  }

  render(state: TuiState): string {
    const theme = getTheme(state.theme);
    const { width, height } = state;
    const key = (k: string) => renderKey(k, theme);
    const rule = `     ${theme.border}${'─'.repeat(67)}${ANSI.reset}`;

    const menuContent = [
      '',
      `     ${theme.accent}${ANSI.bold}SELF-OPTIMIZING LLM AGENT FOR SE WORKFLOWS${ANSI.reset}`,
      `     ${theme.fgMuted}Central LazyVim-style Navigation Hub · Switch between any module${ANSI.reset}`,
      '',
      rule,
      '',
      `     ${key('1')}  ${theme.fg}${ANSI.bold}Execution Core${ANSI.reset}            ${theme.fgMuted}Deterministic Sandbox & Tool Runner${ANSI.reset}`,
      `     ${key('2')}  ${theme.fg}${ANSI.bold}HEAE Evaluation${ANSI.reset}           ${theme.fgMuted}Failure Attribution, Rules & Local Judge${ANSI.reset}`,
      `     ${key('3')}  ${theme.fg}${ANSI.bold}Memory Agent${ANSI.reset}              ${theme.fgMuted}Code-grounded Working Memory & Notes${ANSI.reset}`,
      `     ${key('4')}  ${theme.fg}${ANSI.bold}Optimization Orchestrator${ANSI.reset} ${theme.fgMuted}6-Axis Config Evolution & Stability${ANSI.reset}`,
      '',
      rule,
      '',
      `     ${key('c')}  ${theme.fg}Contract Health Check${ANSI.reset}     ${renderBadge('5/5 VALID', 'built', theme)} ${theme.fgMuted}Zod schemas verification${ANSI.reset}`,
      `     ${key('?')}  ${theme.fg}Help & Keybindings Guide${ANSI.reset}   ${theme.fgMuted}Detailed shortcuts and module reference${ANSI.reset}`,
      `     ${key('t')}  ${theme.fg}Switch Theme${ANSI.reset}              ${renderBadge(theme.name, 'info', theme)} ${theme.fgMuted}(Cyber / Nord / Catppuccin / Light)${ANSI.reset}`,
      `     ${key('q')}  ${theme.fg}Quit Application${ANSI.reset}          ${theme.fgMuted}Exit interactive terminal${ANSI.reset}`,
      '',
      `     ${theme.fgDim}Tip: Press [Esc] or [m] to return to previous dashboard (${state.previousView ?? 'exec'})${ANSI.reset}`,
      '',
    ];

    const selected = MENU_ITEMS[state.selectedItemIndex] ?? MENU_ITEMS[0]!;
    const boxWidth = Math.min(width, 96);
    const boxHeight = Math.min(height, menuContent.length + 2);

    const box = renderPanel(
      {
        title: 'SOA MODULE SELECTOR (LazyVim Menu)',
        active: true,
        build: (innerWidth) =>
          menuContent.map((line, i) =>
            i === selected.line ? highlightRow(line, innerWidth, theme) : line,
          ),
        focus: [selected.line, selected.line + 1],
      },
      boxWidth,
      boxHeight,
      theme,
    );

    // Block-letter "SOA" header above the box, when there is room for it.
    const header = renderBlockTitle('SOA', boxWidth, theme);
    const headerLines = [...header, `${theme.fgMuted}${BOOT_SUBTITLE}${ANSI.reset}`, ''];
    if (height - box.length < headerLines.length) {
      return centerBlock(box, width, height).join('\n');
    }
    const centerIn = (line: string) =>
      ' '.repeat(Math.max(0, Math.floor((boxWidth - visibleLength(line)) / 2))) + line;
    return centerBlock([...headerLines.map(centerIn), ...box], width, height).join('\n');
  }
}
