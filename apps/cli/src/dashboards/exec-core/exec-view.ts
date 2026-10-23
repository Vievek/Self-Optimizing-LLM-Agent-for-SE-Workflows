import type { DashboardView, TuiState, ViewAction } from '../types.js';
import {
  ANSI,
  getTheme,
  highlightRow,
  renderBadge,
  renderBox,
  renderPanel,
  renderTopHeader,
  spacer,
  toLines,
  vstack,
} from '../../theme/index.js';
import { renderControlBar } from '../../components/index.js';

/** Each step takes a title line, a detail line and a blank line. */
const STEP_LINES = 3;
const STEP_COUNT = 5;

export class ExecCoreDashboardView implements DashboardView {
  id = 'exec';
  name = 'Execution Core';
  title = 'Execution Core · Deterministic Sandbox & Agent Runner';
  tabs = ['Task Stream', 'Tool Spans', 'AST Graph', 'Sandbox'];
  actionLabel = 'new task';

  itemCount(): number {
    return STEP_COUNT;
  }

  activate(): ViewAction {
    return { type: 'busy', verb: 'Running task', durationMs: 1200, done: 'Task finished' };
  }

  status(state: TuiState): string {
    const tab = this.tabs[state.activeTab % this.tabs.length] ?? 'Task Stream';
    return `${tab} · Status: Idle · Ephemeral sandbox ready`;
  }

  render(state: TuiState): string {
    const theme = getTheme(state.theme);
    const { width, height } = state;
    const selected = state.selectedItemIndex;

    // 1. Header
    const header = renderTopHeader(
      'soa exec',
      this.title,
      'DEFAULT WORKSPACE · interactive agent',
      theme,
      width,
    );

    // 2. Control row
    const promptPill = `${theme.accent}${ANSI.bold}ACTIVE MODEL:${ANSI.reset} ${renderBadge('Qwen2.5-Coder-7B (SLM)', 'built', theme)}  ${theme.fgMuted}Router Score: 0.88${ANSI.reset}`;
    const controlRow = renderControlBar({
      themeName: state.theme,
      tabs: this.tabs,
      activeTab: state.activeTab,
      leftBadge: promptPill,
      theme,
      width,
    });

    // 3. Input prompt
    const promptBox = renderBox(
      [
        ` ${theme.accent}${ANSI.bold}❯ Issue / Task:${ANSI.reset} ${theme.fg}django__django-11099 - Username regex validator fails with trailing newline${ANSI.reset}`,
        `   ${theme.fgDim}Repository: django/django @ commit fb8b75e7a9 · Sandbox: isolated ephemeral docker${ANSI.reset}`,
      ],
      { title: 'Input Prompt', width, style: 'hud', theme },
    );

    // 4. Step stream execution trace (selected step highlighted)
    const check = `${theme.badgeBuiltBg}${theme.badgeBuiltFg} ✔ ${ANSI.reset}`;
    const buildSteps = (innerWidth: number) => {
      const steps = [
        ` ${check} ${theme.fg}${ANSI.bold}Step 1: AST Code Graph Retrieval${ANSI.reset}  ${renderBadge('AST-GRAPH', 'built', theme)}`,
        `   ${theme.fgMuted}Parsed Python AST -> Located validators.py (Symbol: ASCIIUsernameValidator)${ANSI.reset}`,
        '',
        ` ${check} ${theme.fg}${ANSI.bold}Step 2: Dynamic Model Tier Selection${ANSI.reset}  ${renderBadge('ROUTING', 'info', theme)}`,
        `   ${theme.fgMuted}Features: complexity=0.2, context=small, prior_failures=0 -> Routed to SLM (7B)${ANSI.reset}`,
        '',
        ` ${check} ${theme.fg}${ANSI.bold}Step 3: Tool Dispatch & Code Inspection${ANSI.reset}  ${renderBadge('TOOL: read_file', 'headline', theme)}`,
        `   ${theme.fgMuted}read_file("django/contrib/auth/validators.py", offset=1, limit=50)${ANSI.reset}`,
        '',
        ` ${check} ${theme.fg}${ANSI.bold}Step 4: Patch Generation & Precision Edit${ANSI.reset}  ${renderBadge('TOOL: edit_file', 'headline', theme)}`,
        `   ${theme.fgMuted}Replaced regex pattern r'^[\\w.@+-]+$' -> anchored r'\\A[\\w.@+-]+\\Z'${ANSI.reset}`,
        '',
        ` ${check} ${theme.fg}${ANSI.bold}Step 5: Ephemeral Sandbox Verification${ANSI.reset}  ${renderBadge('VERIFIED', 'built', theme)}`,
        `   ${theme.fgMuted}pytest tests/auth_tests/test_validators.py -> 5/5 passed in 820ms${ANSI.reset}`,
      ];
      const row = selected * STEP_LINES;
      if (steps[row] !== undefined) steps[row] = highlightRow(steps[row]!, innerWidth, theme);
      return steps;
    };

    const stream = (h: number) =>
      renderPanel(
        {
          title: 'Agent Execution Stream & Tool Calls',
          active: true,
          build: buildSteps,
          focus: [selected * STEP_LINES, selected * STEP_LINES + 2],
        },
        width,
        h,
        theme,
      );

    const gap = spacer(height);
    return vstack(
      [
        toLines(header),
        gap,
        toLines(controlRow),
        gap,
        toLines(promptBox),
        gap,
        { grow: 1, render: stream },
      ],
      width,
      height,
    ).join('\n');
  }
}
