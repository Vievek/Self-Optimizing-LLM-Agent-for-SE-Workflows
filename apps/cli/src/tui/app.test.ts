import { describe, expect, it } from 'vitest';
import { TuiApp } from './app.js';
import { getTheme, setTheme, cycleTheme, THEMES } from '../theme/theme.js';
import { renderBox, renderPill, renderBadge, renderStatusBar, renderTopHeader } from '../theme/box.js';

describe('TUI Theme & CSS-Like Styling Engine', () => {
  it('loads and cycles themes', () => {
    setTheme('nord');
    expect(getTheme().name).toBe('Nord');

    const next = cycleTheme();
    expect(next).toBe('catppuccin');
    expect(getTheme().name).toBe('Catppuccin');

    cycleTheme();
    expect(getTheme().name).toBe('Light');

    cycleTheme();
    expect(getTheme().name).toBe('Nord');
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

    const status = renderStatusBar('soa memory', [{ key: 'm', label: 'menu' }], 'Status ready', 80, theme);
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
    expect(app.getState().activeView).toBe('exec');
    const output = app.renderCurrent();
    expect(output).toContain('Execution Core');
    expect(output).toContain('Task Stream');
  });

  it('toggles LazyVim main menu with "m" key and returns on "m" or Escape', () => {
    const app = new TuiApp('memory');
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

    app.handleInput('1');
    expect(app.getState().activeView).toBe('exec');

    app.handleInput('2');
    expect(app.getState().activeView).toBe('heae');
    expect(app.renderCurrent()).toContain('HEAE Evaluation');

    app.handleInput('3');
    expect(app.getState().activeView).toBe('memory');
    const memOutput = app.renderCurrent();
    expect(memOutput).toContain('Code-grounded Memory Agent');
    expect(memOutput).toContain('Pipeline');
    expect(memOutput).toContain('Focus working memory');
    expect(memOutput).toContain('Code-grounded verification');
    expect(memOutput).toContain('Store');
    expect(memOutput).toContain('Repo status');

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

