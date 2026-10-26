import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRAME_MS, OVERLAY_MIN_MS, SPLASH_MS, TuiApp } from './app.js';
import { parseCliOptions } from './cli-options.js';
import { runContractHealthCheck, summarizeContractHealth } from '../contract-health.js';
import { ExecRunnerService } from '../dashboards/exec-core/index.js';
import { renderFrameUpdate } from './screen.js';
import { stripAnsi } from '../theme/text.js';
import {
  DEFAULT_THEME,
  THEME_ORDER,
  getTheme,
  setTheme,
  cycleTheme,
  THEMES,
} from '../theme/theme.js';
import {
  renderBox,
  renderPill,
  renderBadge,
  renderStatusBar,
  renderTopHeader,
} from '../theme/box.js';

describe('TUI Theme & CSS-Like Styling Engine', () => {
  it('loads and cycles themes', () => {
    setTheme('nord');
    expect(getTheme().name).toBe('Nord');

    const next = cycleTheme();
    expect(next).toBe('catppuccin');
    expect(getTheme().name).toBe('Catppuccin');

    cycleTheme();
    expect(getTheme().name).toBe('Light');

    // After Light the cycle wraps to Cyber (first in the order), then Nord.
    cycleTheme();
    expect(getTheme().name).toBe('Cyber');

    cycleTheme();
    expect(getTheme().name).toBe('Nord');
  });

  it('starts the theme cycle with cyber, the default', () => {
    expect(THEME_ORDER[0]).toBe('cyber');
    expect(DEFAULT_THEME).toBe('cyber');
    setTheme('light');
    expect(cycleTheme()).toBe('cyber');
    new TuiApp('exec');
    expect(getTheme().name).toBe('Cyber');
  });

  it('renders styled boxes, pills, and badges', () => {
    const theme = THEMES.nord!;
    const box = renderBox(['Hello world', 'Second line'], { title: 'Test Box', theme });
    expect(box).toContain('Test Box');
    expect(box).toContain('Hello world');
    expect(box).toContain('╭');
    expect(box).toContain('╯');

    const pill = renderPill('Nord', true, theme);
    expect(pill).toContain('Nord');

    const badgeBuilt = renderBadge('BUILT', 'built', theme);
    expect(badgeBuilt).toContain('BUILT');

    const badgeHeadline = renderBadge('HEADLINE · BUILT', 'headline', theme);
    expect(badgeHeadline).toContain('HEADLINE · BUILT');

    const status = renderStatusBar(
      'soa memory',
      [{ key: 'm', label: 'menu' }],
      'Status ready',
      80,
      theme,
    );
    expect(status).toContain('soa memory');
    expect(status).toContain('menu');

    const header = renderTopHeader('soa memory', 'Memory Agent Subtitle', 'MOCK DATA', theme, 80);
    expect(header).toContain('soa memory');
    expect(header).toContain('Memory Agent Subtitle');
  });
});

describe('TuiApp Global Navigation & Keybindings', () => {
  it('initializes to exec view by default', () => {
    const app = new TuiApp('exec');
    app.setSize(100, 30);
    expect(app.getState().activeView).toBe('exec');
    const output = app.renderCurrent();
    expect(output).toContain('Execution Core');
    expect(output).toContain('Task Stream');
  });

  it('renders all 5 execution core tabs with dedicated views', () => {
    const app = new TuiApp('exec', 'cyber', { animate: false });
    // Tab 0: Agent Console
    let out = app.renderCurrent();
    expect(out).toContain('Thinking...');
    expect(out).toContain('INTERACTIVE CONSOLE INPUT');

    // Tab 1: Task Stream
    app.handleInput({ name: 'tab' });
    out = app.renderCurrent();
    expect(out).toContain('REACT EXECUTION PIPELINE');
    expect(out).toContain('DYNAMIC MODEL TIER ROUTING');

    // Tab 2: Tool Spans
    app.handleInput({ name: 'tab' });
    out = app.renderCurrent();
    expect(out).toContain('OPENTELEMETRY TOOL CALL SPANS');
    expect(out).toContain('SPAN INSPECTOR');

    // Tab 3: AST Graph
    app.handleInput({ name: 'tab' });
    out = app.renderCurrent();
    expect(out).toContain('CODEBASE AST HIERARCHY');
    expect(out).toContain('SYMBOL INSPECTOR');

    // Tab 4: Sandbox
    app.handleInput({ name: 'tab' });
    out = app.renderCurrent();
    expect(out).toContain('EPHEMERAL SANDBOX EXECUTION');
    expect(out).toContain('GENERATED PATCH');
  });

  it('toggles LazyVim main menu with "m" key and returns on "m" or Escape', () => {
    const app = new TuiApp('memory');
    app.setSize(100, 30);
    expect(app.getState().activeView).toBe('memory');

    // Press 'm' to open LazyVim Menu
    const cont1 = app.handleInput('m');
    expect(cont1).toBe(true);
    expect(app.getState().activeView).toBe('menu');
    expect(app.renderCurrent()).toContain('SOA MODULE SELECTOR');

    // Press 'm' again to return to memory view
    app.handleInput('m');
    expect(app.getState().activeView).toBe('memory');

    // Press 'm' to open, then Escape to return
    app.handleInput('m');
    expect(app.getState().activeView).toBe('menu');
    app.handleInput('\x1b');
    expect(app.getState().activeView).toBe('memory');
  });

  it('toggles help view with "?" or "h" key', () => {
    const app = new TuiApp('exec');
    app.setSize(100, 30);
    expect(app.getState().activeView).toBe('exec');

    app.handleInput('?');
    expect(app.getState().activeView).toBe('help');
    const helpOutput = app.renderCurrent();
    expect(helpOutput).toContain('KEYBINDINGS & SYSTEM OVERVIEW');
    expect(helpOutput).toContain('GLOBAL NAVIGATION SHORTCUTS');

    // Toggle back
    app.handleInput('?');
    expect(app.getState().activeView).toBe('exec');
  });

  it('switches views with number shortcuts 1-4', () => {
    const app = new TuiApp('menu');
    app.setSize(100, 30);

    app.handleInput('1');
    expect(app.getState().activeView).toBe('exec');

    app.handleInput('2');
    expect(app.getState().activeView).toBe('heae');
    expect(app.renderCurrent()).toContain('HEAE Evaluation');

    app.handleInput('3');
    expect(app.getState().activeView).toBe('memory');
    expect(app.getState().activeTab).toBe(0);
    const memOutput = app.renderCurrent();
    expect(memOutput).toContain('Code-grounded Memory Agent');
    expect(memOutput).toContain('Pipeline');
    expect(memOutput).toContain('Focus working memory');
    // Section labels are drawn in the HUD style: "// STORE", "// REPO STATUS".
    expect(memOutput).toContain('// STORE');
    expect(memOutput).toContain('VERIFIED');
    expect(memOutput).toContain('STALE');

    app.handleInput('4');
    expect(app.getState().activeView).toBe('orch');
    expect(app.renderCurrent()).toContain('Optimization Orchestrator');
  });

  it('cycles views tabs with tab key and theme with t key', () => {
    const app = new TuiApp('memory');
    expect(app.getState().activeTab).toBe(0);

    app.handleInput('\t');
    expect(app.getState().activeTab).toBe(1);

    const prevTheme = app.getState().theme;
    app.handleInput('t');
    expect(app.getState().theme).not.toBe(prevTheme);
  });

  it('handles exit with q key', () => {
    const app = new TuiApp('exec');
    const cont = app.handleInput('q');
    expect(cont).toBe(false);
  });
});

describe('TuiApp keys (readline keypress names)', () => {
  it('quits on q and on Ctrl+C', () => {
    expect(new TuiApp('exec').handleInput({ name: 'q', sequence: 'q' })).toBe(false);
    expect(new TuiApp('exec').handleInput({ name: 'c', ctrl: true, sequence: '\u0003' })).toBe(
      false,
    );
    expect(new TuiApp('exec').handleInput({ name: 'c', sequence: 'c' })).toBe(true);
  });

  it('goes back from menu and help on "escape"', () => {
    const app = new TuiApp('heae');
    app.handleInput({ name: 'm', sequence: 'm' });
    expect(app.getState().activeView).toBe('menu');
    app.handleInput({ name: 'escape', sequence: '\x1b' });
    expect(app.getState().activeView).toBe('heae');

    app.handleInput({ sequence: '?' });
    expect(app.getState().activeView).toBe('help');
    app.handleInput({ name: 'escape', sequence: '\x1b' });
    expect(app.getState().activeView).toBe('heae');
  });

  it('moves forward with "tab" and back with shift+tab, using the real tab count', () => {
    const exec = new TuiApp('exec'); // 5 tabs: Agent Console, Task Stream, Tool Spans, AST Graph, Sandbox
    for (let i = 0; i < 4; i++) exec.handleInput({ name: 'tab', sequence: '\t' });
    expect(exec.getState().activeTab).toBe(4);
    exec.handleInput({ name: 'tab', sequence: '\t' });
    expect(exec.getState().activeTab).toBe(0);
    exec.handleInput({ name: 'tab', shift: true, sequence: '\x1b[Z' });
    expect(exec.getState().activeTab).toBe(4);

    const memory = new TuiApp('memory'); // 6 tabs
    for (let i = 0; i < 5; i++) memory.handleInput({ name: 'tab' });
    expect(memory.getState().activeTab).toBe(5);
    memory.handleInput({ name: 'tab' });
    expect(memory.getState().activeTab).toBe(0);
  });

  it('switches tabs with the left and right arrows', () => {
    const app = new TuiApp('orch');
    app.handleInput({ name: 'right' });
    app.handleInput({ name: 'right' });
    expect(app.getState().activeTab).toBe(2);
    app.handleInput({ name: 'left' });
    expect(app.getState().activeTab).toBe(1);
    app.handleInput({ name: 'left' });
    app.handleInput({ name: 'left' });
    expect(app.getState().activeTab).toBe(3);
  });

  it('moves the selection with up/down and j/k, clamped to the list', () => {
    const app = new TuiApp('memory'); // 6 stages
    app.handleInput({ name: 'down' });
    app.handleInput({ name: 'j', sequence: 'j' });
    expect(app.getState().selectedItemIndex).toBe(2);
    app.handleInput({ name: 'up' });
    expect(app.getState().selectedItemIndex).toBe(1);
    app.handleInput({ name: 'k', sequence: 'k' });
    app.handleInput({ name: 'k', sequence: 'k' });
    expect(app.getState().selectedItemIndex).toBe(0);
    for (let i = 0; i < 10; i++) app.handleInput({ name: 'down' });
    expect(app.getState().selectedItemIndex).toBe(5);
  });

  it('runs the selected action on "return"', () => {
    const app = new TuiApp('memory', 'nord', { animate: false });
    app.setSize(100, 30);
    app.handleInput({ name: 'down' });
    app.handleInput({ name: 'down' });
    app.handleInput({ name: 'down' }); // Code-grounded verification
    app.handleInput({ name: 'return', sequence: '\r' });
    expect(app.getToast()).toBe('[ ✔ DONE ] Verification complete');
    expect(stripAnsi(app.renderCurrent())).toContain('[ ✔ DONE ] Verification complete');
  });

  it('opens the selected menu entry on "return"', () => {
    const app = new TuiApp('exec', 'nord', { animate: false });
    app.handleInput({ name: 'm' });
    app.handleInput({ name: 'down' });
    app.handleInput({ name: 'down' }); // 3 Memory Agent
    app.handleInput({ name: 'return' });
    expect(app.getState().activeView).toBe('memory');
  });
});

describe('TuiApp busy indicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('animates while busy and stops the timer after the duration', () => {
    const app = new TuiApp('memory', 'nord', { animate: true });
    app.setSize(120, 40);
    app.startBusy('Verifying memory', 600);
    expect(app.isBusy()).toBe(true);
    expect(app.isAnimating()).toBe(true);
    expect(stripAnsi(app.renderCurrent())).toContain('Verifying memory');

    vi.advanceTimersByTime(FRAME_MS * 2);
    expect(app.isBusy()).toBe(true);

    vi.advanceTimersByTime(600);
    expect(app.isBusy()).toBe(false);
    expect(app.isAnimating()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(app.getToast()).toBe('[ ✔ DONE ] Done');
  });

  it('stops the timer when Esc is pressed', () => {
    const app = new TuiApp('memory', 'nord', { animate: true });
    app.startBusy('Re-checking commit', 1200);
    vi.advanceTimersByTime(FRAME_MS);
    app.handleInput({ name: 'escape' });
    expect(app.isBusy()).toBe(false);
    expect(app.isAnimating()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(app.getToast()).toBe('[ ✖ FAIL ] Aborted by user');
    // Esc while busy cancels the task, it does not leave the view.
    expect(app.getState().activeView).toBe('memory');
  });

  it('shows the PC buddy overlay for longer tasks', () => {
    const app = new TuiApp('memory', 'nord', { animate: true });
    app.setSize(120, 40);
    app.startBusy('Linking notes', OVERLAY_MIN_MS + 200);
    const frame = stripAnsi(app.renderCurrent());
    expect(frame).toContain('┗━┳━━━━━┳━┛'); // SOA-BOT's neck
    expect(frame).toContain('PROCESSING // Linking notes');
    expect(frame).toContain('[esc] abort');
    app.cancelBusy();
  });

  it('shows "Loading dashboard" when switching modules', () => {
    const app = new TuiApp('exec', 'nord', { animate: true });
    app.setSize(120, 40);
    app.handleInput('3');
    expect(app.getState().activeView).toBe('memory');
    expect(stripAnsi(app.renderCurrent())).toContain('Loading dashboard');
    vi.advanceTimersByTime(1500);
    expect(app.isBusy()).toBe(false);
  });

  it('uses no timers with animation off', () => {
    const app = new TuiApp('memory', 'nord', { animate: false });
    app.startBusy('Verifying memory', 1200);
    app.handleInput('2');
    expect(app.isBusy()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(app.getToast()).toBe('[ ✔ DONE ] Dashboard loaded');
  });
});

describe('Screen updates', () => {
  it('never clears the whole screen and only rewrites changed lines', () => {
    const first = renderFrameUpdate(undefined, ['aaa', 'bbb', 'ccc']);
    expect(first).not.toContain('\x1b[2J');
    expect(first).toContain('\x1b[H');
    expect(first).toContain('\x1b[K');
    expect(first).toContain('\x1b[J');

    const next = renderFrameUpdate(['aaa', 'bbb', 'ccc'], ['aaa', 'BBB', 'ccc']);
    expect(next).toContain('\x1b[2;1H');
    expect(next).toContain('BBB');
    expect(next).not.toContain('aaa');
    expect(renderFrameUpdate(['aaa'], ['aaa'])).toBe('');
  });
});

describe('Boot sequence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('types out the boot lines with the real contract check result, then ends', () => {
    const app = new TuiApp('exec', 'cyber', { animate: true });
    app.setSize(120, 40);
    app.startBootSequence();
    expect(app.isSplashVisible()).toBe(true);

    vi.advanceTimersByTime(SPLASH_MS - 120);
    const frame = stripAnsi(app.renderCurrent());
    const contracts = summarizeContractHealth(runContractHealthCheck());
    expect(frame).toContain('SELF-OPTIMIZING SE AGENT // v0.1');
    expect(frame).toContain('INIT  core runtime');
    expect(frame).toContain(`LOAD  contracts · ${contracts}`);
    expect(frame).toContain('LINK  exec-core · heae · memory · orch');
    expect(frame).toContain('SYNC  theme: cyber');
    expect(frame).toContain('READY');
    expect(frame).toContain('[ OK ]');

    vi.advanceTimersByTime(240);
    expect(app.isSplashVisible()).toBe(false);
    expect(app.isAnimating()).toBe(false);
  });

  it('is skipped by any key', () => {
    const app = new TuiApp('exec', 'cyber', { animate: true });
    app.startBootSequence();
    app.handleInput('x');
    expect(app.isSplashVisible()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is skipped entirely with --no-anim or without a TTY', () => {
    expect(parseCliOptions(['tui', 'memory', '--no-anim'], true)).toEqual({
      args: ['tui', 'memory'],
      animate: false,
    });
    expect(parseCliOptions(['tui'], false).animate).toBe(false);
    expect(parseCliOptions(['tui'], true).animate).toBe(true);

    const { animate } = parseCliOptions(['tui', '--no-anim'], true);
    const app = new TuiApp('exec', 'cyber', { animate });
    app.startBootSequence();
    expect(app.isSplashVisible()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(stripAnsi(app.renderCurrent())).not.toContain('INIT  core runtime');
  });
});

describe('Execution Core Interactive Agent Console & Dynamic Real Data', () => {
  it('supports interactive prompt typing in insert mode', () => {
    const app = new TuiApp('exec', 'cyber', { animate: false });
    const runner = ExecRunnerService.getInstance();
    runner.clearPrompt();

    // 1. Enter Insert Mode using 'i'
    app.handleInput('i');
    let out = stripAnsi(app.renderCurrent());
    expect(out).toContain('[INSERT MODE]');

    // 2. Type characters: "Fix bug"
    for (const ch of 'Fix bug') {
      app.handleInput(ch);
    }
    out = stripAnsi(app.renderCurrent());
    expect(out).toContain('Fix bug');
    expect(runner.getState().prompt).toBe('Fix bug');

    // 3. Backspace deletes last character
    app.handleInput({ name: 'backspace' });
    expect(runner.getState().prompt).toBe('Fix bu');

    // 4. Escape leaves insert mode
    app.handleInput({ name: 'escape' });
    out = stripAnsi(app.renderCurrent());
    expect(out).toContain('[NORMAL MODE]');
    expect(out).toContain('Fix bu');
  });

  it('scans real workspace symbols dynamically for AST Graph view without mock data', () => {
    const app = new TuiApp('exec', 'cyber', { animate: false });
    // Switch to Tab 3 (AST Graph)
    app.handleInput({ name: 'tab' }); // Tab 1
    app.handleInput({ name: 'tab' }); // Tab 2
    app.handleInput({ name: 'tab' }); // Tab 3
    const out = stripAnsi(app.renderCurrent());
    expect(out).toContain('CODEBASE AST HIERARCHY');
    expect(out).toContain('SYMBOL INSPECTOR');
    // Ensure hardcoded Django/Mongoose sample nodes are completely absent
    expect(out).not.toContain('server/models/Project.js');
    expect(out).not.toContain('CommonJS exports = mongoose.model');
  });

  it('renders clean real sandbox view without hardcoded mock command or diff', () => {
    const app = new TuiApp('exec', 'cyber', { animate: false });
    // Switch to Tab 4 (Sandbox)
    app.handleInput({ name: 'tab' }); // 1
    app.handleInput({ name: 'tab' }); // 2
    app.handleInput({ name: 'tab' }); // 3
    app.handleInput({ name: 'tab' }); // 4
    const out = stripAnsi(app.renderCurrent());
    expect(out).toContain('EPHEMERAL SANDBOX EXECUTION');
    expect(out).toContain('GENERATED PATCH');
    // Ensure hardcoded test command and mock Project.js diff are completely absent
    expect(out).not.toContain('npm test -- server/tests/projectController.test.js');
    expect(out).not.toContain('module.exports = ProjectSchema');
  });

  it('starts fresh on new open and supports history navigation and fresh reset', () => {
    const app = new TuiApp('exec', 'cyber', { animate: false });
    const runner = ExecRunnerService.getInstance();
    runner.resetToFresh();

    // Default startup must be clean and centered
    let out = stripAnsi(app.renderCurrent());
    expect(out).toContain('SELF-OPTIMIZING SE AGENT');
    expect(out).toContain('INTERACTIVE CONSOLE INPUT');
    expect(out).toContain('READY');

    // Simulate N key resets back to fresh session
    app.handleInput({ sequence: 'N' });
    out = stripAnsi(app.renderCurrent());
    expect(out).toContain('READY');
    expect(out).toContain('SELF-OPTIMIZING SE AGENT');
  });

  it('toggles interactive history trace picker on H key and closes on escape', () => {
    const app = new TuiApp('exec', 'cyber', { animate: false });
    const runner = ExecRunnerService.getInstance();
    runner.resetToFresh();

    // Press H to open History picker
    app.handleInput({ sequence: 'H' });
    let out = stripAnsi(app.renderCurrent());
    expect(out).toContain('EXECUTION TRACE HISTORY');

    // Press escape to close History picker
    app.handleInput({ name: 'escape' });
    out = stripAnsi(app.renderCurrent());
    expect(out).not.toContain('EXECUTION TRACE HISTORY');
    expect(out).toContain('SELF-OPTIMIZING SE AGENT');
  });

  it('renders turn inspector in Task Stream, span inspector in Tool Spans, and report in Console', () => {
    const app = new TuiApp('exec', 'cyber', { animate: false });
    const runner = ExecRunnerService.getInstance();
    runner.resetToFresh();

    // Populate a test turn, span, and final resolution
    (runner as any).state.turns = [
      {
        turnIndex: 1,
        action: 'list_directory',
        thought: 'Inspecting workspace directories',
        actionInput: { path: '.' },
        observation: 'Found client, server, package.json',
        status: 'ok',
      },
    ];
    (runner as any).state.spans = [
      {
        span_id: 'span-abc-123',
        trace_id: 'trace-xyz-789',
        name: 'list_directory',
        start_ts: new Date().toISOString(),
        end_ts: new Date().toISOString(),
        status: 'ok',
        attributes: { tool_name: 'list_directory', args: { path: '.' }, output: 'Found files' },
      },
    ];
    (runner as any).state.finalAnswer = 'Comprehensive project architecture report.';

    // Tab 0: Agent Console should render formatted report and omit Thinking card
    let out = stripAnsi(app.renderCurrent());
    expect(out).toContain('AGENT RESOLUTION & REPORT');
    expect(out).toContain('Comprehensive project architecture report');
    expect(out).not.toContain('Thinking...');

    // Pressing return on Tab 0 with empty active prompt enters insert mode without re-running
    app.handleInput({ name: 'return' });
    out = stripAnsi(app.renderCurrent());
    expect(out).toContain('[INSERT MODE]');
    app.handleInput({ name: 'escape' }); // back to normal mode

    // Tab 1: Task Stream should render Turn 1 Inspector and full execution summary
    app.handleInput({ name: 'tab' });
    out = stripAnsi(app.renderCurrent());
    expect(out).toContain('TURN 1 INSPECTOR');
    expect(out).toContain('Inspecting workspace directories');
    expect(out).toContain('Found client, server, package.json');
    expect(out).toContain('TOTAL EXECUTION SUMMARY & METRICS');
    expect(out).toContain('Time Taken:');
    expect(out).toContain('Tokens In:');
    expect(out).toContain('Tokens Out:');

    // Tab 2: Tool Spans should render Span Inspector with output
    app.handleInput({ name: 'tab' });
    out = stripAnsi(app.renderCurrent());
    expect(out).toContain('SPAN INSPECTOR & ARGUMENTS');
    expect(out).toContain('span-abc-123');
    expect(out).toContain('TOOL OUTPUT / RESULT');
  });
});
