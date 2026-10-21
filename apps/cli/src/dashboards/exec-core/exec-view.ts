import type { DashboardView, TuiState } from '../types.js';
import {
  ANSI,
  getTheme,
  renderBadge,
  renderBox,
  renderPill,
  renderStatusBar,
  renderTopHeader,
} from '../../theme/index.js';

export class ExecCoreDashboardView implements DashboardView {
  id = 'exec';
  name = 'Execution Core';
  title = 'Execution Core · Deterministic Sandbox & Agent Runner';
  tabs = ['Task Stream', 'Tool Spans', 'AST Graph', 'Sandbox'];

  render(state: TuiState): string {
    const theme = getTheme(state.theme);
    const availableWidth = state.width ? state.width - 4 : 100;
    const width = Math.max(92, Math.min(availableWidth, 140));

    // 1. Header
    const header = renderTopHeader(
      'soa exec',
      this.title,
      'DEFAULT WORKSPACE · interactive agent',
      theme,
      width,
    );

    // 2. Control row
    const activeTabIdx = state.activeTab % this.tabs.length;
    const viewTabs = [
      'Views',
      ...this.tabs.map((tab, idx) => renderPill(tab, idx === activeTabIdx, theme)),
    ].join('  ');

    const promptPill = `${theme.accent}${ANSI.bold}ACTIVE MODEL:${ANSI.reset} ${renderBadge('Qwen2.5-Coder-7B (SLM)', 'built', theme)}  ${theme.fgMuted}Router Score: 0.88${ANSI.reset}`;
    const controlRow = `${promptPill}     ${viewTabs}`;

    // 3. Main Claude Code style interaction canvas
    const promptBox = renderBox(
      [
        ` ${theme.accent}${ANSI.bold}❯ Issue / Task:${ANSI.reset} ${theme.fg}django__django-11099 - Username regex validator fails with trailing newline${ANSI.reset}`,
        `   ${theme.fgDim}Repository: django/django @ commit fb8b75e7a9 · Sandbox: isolated ephemeral docker${ANSI.reset}`,
      ],
      {
        title: 'Input Prompt',
        width,
        rounded: true,
        theme,
      },
    );

    // Step stream execution trace
    const steps = [
      ` ${theme.badgeBuiltBg} ✔ ${ANSI.reset} ${theme.fg}${ANSI.bold}Step 1: AST Code Graph Retrieval${ANSI.reset}  ${renderBadge('AST-GRAPH', 'built', theme)}`,
      `   ${theme.fgMuted}Parsed Python AST -> Located validators.py (Symbol: ASCIIUsernameValidator)${ANSI.reset}`,
      '',
      ` ${theme.badgeBuiltBg} ✔ ${ANSI.reset} ${theme.fg}${ANSI.bold}Step 2: Dynamic Model Tier Selection${ANSI.reset}  ${renderBadge('ROUTING', 'info', theme)}`,
      `   ${theme.fgMuted}Features: complexity=0.2, context=small, prior_failures=0 -> Routed to SLM (7B)${ANSI.reset}`,
      '',
      ` ${theme.badgeBuiltBg} ✔ ${ANSI.reset} ${theme.fg}${ANSI.bold}Step 3: Tool Dispatch & Code Inspection${ANSI.reset}  ${renderBadge('TOOL: read_file', 'headline', theme)}`,
      `   ${theme.fgMuted}read_file("django/contrib/auth/validators.py", offset=1, limit=50)${ANSI.reset}`,
      '',
      ` ${theme.badgeBuiltBg} ✔ ${ANSI.reset} ${theme.fg}${ANSI.bold}Step 4: Patch Generation & Precision Edit${ANSI.reset}  ${renderBadge('TOOL: edit_file', 'headline', theme)}`,
      `   ${theme.fgMuted}Replaced regex pattern r'^[\\w.@+-]+$' -> anchored r'\\A[\\w.@+-]+\\Z'${ANSI.reset}`,
      '',
      ` ${theme.badgeBuiltBg} ✔ ${ANSI.reset} ${theme.fg}${ANSI.bold}Step 5: Ephemeral Sandbox Verification${ANSI.reset}  ${renderBadge('VERIFIED', 'built', theme)}`,
      `   ${theme.fgMuted}pytest tests/auth_tests/test_validators.py -> 5/5 passed in 820ms${ANSI.reset}`,
    ];

    const streamBox = renderBox(steps, {
      title: 'Agent Execution Stream & Tool Calls',
      width,
      rounded: true,
      active: true,
      theme,
    });

    // 4. Status Bar
    const activeTabName = this.tabs[activeTabIdx] ?? 'Task Stream';
    const statusBar = renderStatusBar(
      `soa exec · ${activeTabName}`,
      [
        { key: 'm', label: 'main menu' },
        { key: 'tab', label: 'views' },
        { key: '↵', label: 'new task' },
        { key: 't', label: 'theme' },
        { key: 'q', label: 'quit' },
      ],
      'Status: Idle · Ephemeral sandbox ready',
      width,
      theme,
    );

    return [header, '', controlRow, '', promptBox, '', streamBox, '', statusBar].join('\n');
  }
}
