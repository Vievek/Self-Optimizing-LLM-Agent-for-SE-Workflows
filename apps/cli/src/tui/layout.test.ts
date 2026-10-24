import { afterEach, describe, expect, it } from 'vitest';
import { TuiApp } from './app.js';
import {
  THEME_ORDER,
  getColorDepth,
  getTheme,
  hexTo256,
  setColorDepth,
  setColorEnabled,
  type ColorDepth,
  type ThemeName,
} from '../theme/theme.js';
import { blockLines } from '../components/block-title.js';
import { fitWidth, sliceAnsi, stripAnsi, truncate, visibleLength } from '../theme/text.js';
import { renderBox } from '../theme/box.js';

const VIEWS = ['exec', 'heae', 'memory', 'orch', 'menu', 'help'];
const SIZES: Array<[number, number]> = [
  [80, 24],
  [120, 40],
  [200, 60],
];

function frameLines(app: TuiApp): string[] {
  return app.renderCurrent().split('\n').map(stripAnsi);
}

function expectExactFrame(app: TuiApp, columns: number, rows: number): void {
  const lines = frameLines(app);
  expect(lines).toHaveLength(rows);
  lines.forEach((line, i) => {
    expect([...line].length, `line ${i}: "${line}"`).toBe(columns);
  });
}

describe('Full-screen layout', () => {
  afterEach(() => {
    setColorEnabled(undefined);
    setColorDepth(undefined);
  });

  const MODES: Array<{ label: string; theme: ThemeName; color: boolean; depth: ColorDepth }> = [
    ...THEME_ORDER.map((theme) => ({
      label: theme,
      theme,
      color: true,
      depth: 'truecolor' as ColorDepth,
    })),
    { label: 'cyber 256-colour', theme: 'cyber', color: true, depth: '256' },
    { label: 'cyber NO_COLOR', theme: 'cyber', color: false, depth: 'truecolor' },
  ];

  for (const mode of MODES) {
    for (const view of VIEWS) {
      for (const [columns, rows] of SIZES) {
        it(`${view} fills exactly ${columns}x${rows} (${mode.label})`, () => {
          setColorEnabled(mode.color);
          setColorDepth(mode.depth);
          const app = new TuiApp(view, mode.theme, { animate: false });
          app.setSize(columns, rows);
          expectExactFrame(app, columns, rows);
        });
      }
    }
  }

  it('fills the frame exactly during the boot sequence', () => {
    for (const [columns, rows] of SIZES) {
      const app = new TuiApp('exec', 'cyber', { animate: true });
      app.setSize(columns, rows);
      app.startBootSequence();
      expectExactFrame(app, columns, rows);
      app.handleInput('x');
    }
  });

  it('uses 256-colour codes unless COLORTERM is truecolor / 24bit', () => {
    setColorDepth(undefined);
    const saved = process.env.COLORTERM;
    try {
      process.env.COLORTERM = 'truecolor';
      expect(getColorDepth()).toBe('truecolor');
      expect(getTheme('cyber').accent).toContain('38;2;0;229;255');
      process.env.COLORTERM = '24bit';
      expect(getColorDepth()).toBe('truecolor');
      process.env.COLORTERM = '';
      expect(getColorDepth()).toBe('256');
      expect(getTheme('cyber').accent).toBe(`\x1b[38;5;${hexTo256('#00e5ff')}m`);
      expect(hexTo256('#000000')).toBe(16);
      expect(hexTo256('#ffffff')).toBe(231);
    } finally {
      if (saved === undefined) delete process.env.COLORTERM;
      else process.env.COLORTERM = saved;
    }
  });

  it('shows the block-letter header on the main menu when there is room', () => {
    const app = new TuiApp('menu', 'cyber', { animate: false });
    app.setSize(120, 40);
    const frame = frameLines(app).join('\n');
    expect(frame).toContain(blockLines('SOA')[0]);
    expect(frame).toContain('SELF-OPTIMIZING SE AGENT // v0.1');
  });

  it('draws panels as HUD frames with "◢ TITLE ◣"', () => {
    const app = new TuiApp('heae', 'cyber', { animate: false });
    app.setSize(120, 40);
    const frame = frameLines(app).join('\n');
    expect(frame).toContain('┏─ ◢ OVERVIEW ◣');
    expect(frame).toContain('┗');
    expect(frame).toContain('┏─ ◢ HEAE DATA STATUS ◣');
  });

  it('stays exact while scrolling, on every tab and in every theme', () => {
    for (const view of VIEWS) {
      const app = new TuiApp(view, 'nord', { animate: false });
      app.setSize(80, 24);
      for (let i = 0; i < 8; i++) {
        app.handleInput({ name: 'down' });
        app.handleInput({ name: 'tab' });
        if (i % 3 === 0) app.handleInput('t');
        expectExactFrame(app, 80, 24);
      }
    }
  });

  it('keeps the frame exact with the busy overlay on top', () => {
    const app = new TuiApp('heae', 'nord', { animate: true });
    app.setSize(80, 24);
    app.startBusy('Scoring', 1200);
    expectExactFrame(app, 80, 24);
    app.cancelBusy();
  });

  it('shows the top bar with module tabs and the theme', () => {
    const app = new TuiApp('memory', 'nord', { animate: false });
    app.setSize(120, 40);
    const top = frameLines(app)[0]!;
    expect(top).toContain('◤ SOA');
    expect(top).toContain('1 Exec');
    expect(top).toContain('3 Memory');
    expect(top).toContain('4 Orch');
    expect(top).toContain('SOA // MEMORY AGENT');
    expect(top).toContain('NORD');
    expect(top).toContain('SYS ONLINE ●');
  });

  it('shows key hints and the time in the status bar', () => {
    const app = new TuiApp('memory', 'nord', {
      animate: false,
      now: () => new Date(2026, 9, 23, 9, 41),
    });
    app.setSize(160, 40);
    const status = frameLines(app)[39]!;
    expect(status).toContain('module');
    expect(status).toContain('next tab');
    expect(status).toContain('quit');
    expect(status).toContain('09:41');
  });

  it('shows panels side by side when wide and stacked when narrow', () => {
    const wide = new TuiApp('memory', 'nord', { animate: false });
    wide.setSize(120, 40);
    const wideRow = frameLines(wide).find((l) => l.includes('◢ PIPELINE ◣'))!;
    expect(wideRow.match(/┏/g)!.length).toBe(2);

    const narrow = new TuiApp('memory', 'nord', { animate: false });
    narrow.setSize(100, 40);
    const narrowRow = frameLines(narrow).find((l) => l.includes('◢ PIPELINE ◣'))!;
    expect(narrowRow.match(/┏/g)!.length).toBe(1);
  });

  it('asks to enlarge the terminal below 80x24', () => {
    const app = new TuiApp('exec', 'nord', { animate: false });
    app.setSize(70, 20);
    const frame = app.renderCurrent();
    expect(frame).toContain('Please enlarge the terminal (min 80x24) · now 70x20');
    expectExactFrame(app, 70, 20);
  });
});

describe('ANSI-aware text helpers', () => {
  const red = '\x1b[31m';
  const reset = '\x1b[0m';

  it('truncates with an ellipsis instead of wrapping', () => {
    expect(stripAnsi(truncate(`${red}hello world${reset}`, 8))).toBe('hello w…');
    expect(truncate('short', 8)).toBe('short');
    expect(visibleLength(fitWidth(`${red}abc${reset}`, 6))).toBe(6);
    expect(visibleLength(fitWidth('abcdefgh', 4))).toBe(4);
  });

  it('slices visible columns and keeps the active colour', () => {
    const sliced = sliceAnsi(`ab${red}cdef${reset}gh`, 3, 6);
    expect(stripAnsi(sliced)).toBe('def');
    expect(sliced.startsWith(red)).toBe(true);
  });

  it('sizes boxes exactly and scrolls to the focused lines', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const box = renderBox(lines, {
      width: 30,
      height: 8,
      title: 'A very long title indeed',
      scrollTo: [15, 16],
    })
      .split('\n')
      .map(stripAnsi);
    expect(box).toHaveLength(8);
    box.forEach((l) => expect([...l].length).toBe(30));
    expect(box.join('\n')).toContain('line 15');
    expect(box.join('\n')).not.toContain('line 0 ');
  });
});
