import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRAME_MS, OVERLAY_MIN_MS, SPLASH_MS, TuiApp } from './app.js';
import { parseCliOptions } from './cli-options.js';
import { runContractHealthCheck, summarizeContractHealth } from '../contract-health.js';
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
    const exec = new TuiApp('exec'); // 4 tabs
    for (let i = 0; i < 3; i++) exec.handleInput({ name: 'tab', sequence: '\t' });
    expect(exec.getState().activeTab).toBe(3);
    exec.handleInput({ name: 'tab', sequence: '\t' });
    expect(exec.getState().activeTab).toBe(0);
    exec.handleInput({ name: 'tab', shift: true, sequence: '\x1b[Z' });
    expect(exec.getState().activeTab).toBe(3);

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
