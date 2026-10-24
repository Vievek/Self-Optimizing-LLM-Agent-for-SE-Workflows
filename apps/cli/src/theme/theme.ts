/**
 * Central theme file for the SOA TUI.
 *
 * Each theme is a small set of colour tokens (bg, panel, border, text, muted,
 * accent, success, warning, danger, ...). Every escape sequence the components
 * use is derived from those tokens in `buildTheme`, so a visual change only
 * needs to touch the token table below.
 *
 * Colours are 24-bit when COLORTERM is "truecolor" or "24bit", otherwise the
 * nearest xterm 256-colour code is used. NO_COLOR (https://no-color.org) is
 * respected: `getTheme` then returns a variant with every colour empty.
 */

export type ThemeName = 'cyber' | 'nord' | 'catppuccin' | 'light';

/** Order used by the theme cycle (t). */
export const THEME_ORDER: ThemeName[] = ['cyber', 'nord', 'catppuccin', 'light'];

export const DEFAULT_THEME: ThemeName = 'cyber';

/** Hex colours (#rrggbb) that define a theme. */
export interface ThemeTokens {
  bg: string;
  panel: string;
  border: string;
  text: string;
  muted: string;
  /** Secondary hints. Still readable on `bg`. */
  dim: string;
  accent: string;
  /** Secondary accent (neon magenta in cyber). */
  accent2: string;
  success: string;
  warning: string;
  danger: string;
  /** Used for "headline" badges. */
  highlight: string;
  /** Background of the selected list row. */
  selection: string;
  /** Background of key badges in the status bar. */
  chip: string;
  /** Text drawn on top of accent / status colours. */
  onAccent: string;
}

export interface ThemeColors {
  name: string;
  /** True for the NO_COLOR variant. */
  mono: boolean;
  tokens: ThemeTokens;

  // Backgrounds
  bg: string;
  panelBg: string;
  selectionBg: string;
  selectionFg: string;

  // Text
  fg: string;
  fgMuted: string;
  fgDim: string;
  accent: string;
  accentSecondary: string;
  success: string;
  warning: string;
  danger: string;

  // Borders
  border: string;
  borderActive: string;

  // Pills & tabs
  tabActiveBg: string;
  tabActiveFg: string;
  tabInactiveBg: string;
  tabInactiveFg: string;

  // Badges
  badgeBuiltBg: string;
  badgeBuiltFg: string;
  badgeHeadlineBg: string;
  badgeHeadlineFg: string;
  badgePhaseBg: string;
  badgePhaseFg: string;
  badgeWarnBg: string;
  badgeWarnFg: string;
  badgeErrorBg: string;
  badgeErrorFg: string;
  badgeInfoBg: string;
  badgeInfoFg: string;

  // Bars
  statusBarBg: string;
  statusBarFg: string;
  statusBarKeyBg: string;
  statusBarKeyFg: string;
}

export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  clearScreen: '\x1b[2J\x1b[H',
  home: '\x1b[H',
  clearLine: '\x1b[K',
  clearBelow: '\x1b[J',
  enterAltScreen: '\x1b[?1049h\x1b[H',
  exitAltScreen: '\x1b[?1049l',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  /** Synchronized output: terminals that support it paint the frame at once. */
  syncStart: '\x1b[?2026h',
  syncEnd: '\x1b[?2026l',
};

export const TOKENS: Record<ThemeName, ThemeTokens> = {
  cyber: {
    bg: '#0b0f14',
    panel: '#10161d',
    border: '#1f6f8b',
    text: '#d6f4ff',
    muted: '#7fa7b8',
    dim: '#6a8fa0',
    accent: '#00e5ff',
    accent2: '#ff3df2',
    success: '#39ff88',
    warning: '#ffd23f',
    danger: '#ff4d6d',
    highlight: '#ff3df2',
    selection: '#123a4a',
    chip: '#0e3442',
    onAccent: '#0b0f14',
  },
  nord: {
    bg: '#2e3440',
    panel: '#3b4252',
    border: '#4c566a',
    text: '#eceff4',
    muted: '#c0c8d6',
    dim: '#8c98ad',
    accent: '#88c0d0',
    accent2: '#b48ead',
    success: '#a3be8c',
    warning: '#ebcb8b',
    danger: '#bf616a',
    highlight: '#b48ead',
    selection: '#5e81ac',
    chip: '#4c566a',
    onAccent: '#2e3440',
  },
  catppuccin: {
    bg: '#1e1e2e',
    panel: '#313244',
    border: '#585b70',
    text: '#cdd6f4',
    muted: '#bac2de',
    dim: '#9399b2',
    accent: '#89b4fa',
    accent2: '#f5c2e7',
    success: '#a6e3a1',
    warning: '#f9e2af',
    danger: '#f38ba8',
    highlight: '#f5c2e7',
    selection: '#45475a',
    chip: '#45475a',
    onAccent: '#11111b',
  },
  light: {
    bg: '#f5f7fa',
    panel: '#e2e8f0',
    border: '#aab6c5',
    text: '#1f2933',
    muted: '#3e4c5e',
    dim: '#5c6878',
    accent: '#1565c0',
    accent2: '#a3248f',
    success: '#2e7d32',
    warning: '#a15c00',
    danger: '#c62828',
    highlight: '#7b3fa0',
    selection: '#c5dcf7',
    chip: '#c9d3df',
    onAccent: '#ffffff',
  },
};

// ---------------------------------------------------------------------------
// Colour depth
// ---------------------------------------------------------------------------

export type ColorDepth = 'truecolor' | '256';

let depthOverride: ColorDepth | undefined;

/** 24-bit when COLORTERM says so, otherwise 256 colours. */
export function getColorDepth(): ColorDepth {
  if (depthOverride) return depthOverride;
  const colorterm = (process.env.COLORTERM ?? '').toLowerCase();
  return colorterm === 'truecolor' || colorterm === '24bit' ? 'truecolor' : '256';
}

/** Force a colour depth. Pass undefined to go back to reading COLORTERM. */
export function setColorDepth(depth: ColorDepth | undefined): void {
  depthOverride = depth;
}

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

/** Nearest xterm 256-colour index (6x6x6 cube or grey ramp). */
export function hexTo256(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const cubeIndex = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.floor((v - 35) / 40));
  const [ri, gi, bi] = [cubeIndex(r), cubeIndex(g), cubeIndex(b)];
  const cube: [number, number, number] = [CUBE_LEVELS[ri]!, CUBE_LEVELS[gi]!, CUBE_LEVELS[bi]!];

  const avg = Math.round((r + g + b) / 3);
  const grayIndex = Math.max(0, Math.min(23, Math.round((avg - 8) / 10)));
  const grayValue = 8 + grayIndex * 10;

  const dist = ([x, y, z]: [number, number, number]) => (x - r) ** 2 + (y - g) ** 2 + (z - b) ** 2;
  return dist([grayValue, grayValue, grayValue]) < dist(cube)
    ? 232 + grayIndex
    : 16 + 36 * ri + 6 * gi + bi;
}

function colorCode(hex: string, layer: 38 | 48, depth: ColorDepth): string {
  if (depth === 'truecolor') return `\x1b[${layer};2;${parseHex(hex).join(';')}m`;
  return `\x1b[${layer};5;${hexTo256(hex)}m`;
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

export function buildTheme(
  name: string,
  t: ThemeTokens,
  depth: ColorDepth = 'truecolor',
): ThemeColors {
  const fgc = (hex: string) => colorCode(hex, 38, depth);
  const bgc = (hex: string) => colorCode(hex, 48, depth);
  const onAccent = fgc(t.onAccent) + ANSI.bold;
  return {
    name,
    mono: false,
    tokens: t,

    bg: bgc(t.bg),
    panelBg: bgc(t.panel),
    selectionBg: bgc(t.selection),
    selectionFg: fgc(t.text),

    fg: fgc(t.text),
    fgMuted: fgc(t.muted),
    fgDim: fgc(t.dim),
    accent: fgc(t.accent),
    accentSecondary: fgc(t.accent2),
    success: fgc(t.success),
    warning: fgc(t.warning),
    danger: fgc(t.danger),

    border: fgc(t.border),
    borderActive: fgc(t.accent),

    tabActiveBg: bgc(t.accent),
    tabActiveFg: onAccent,
    tabInactiveBg: bgc(t.panel),
    tabInactiveFg: fgc(t.muted),

    badgeBuiltBg: bgc(t.success),
    badgeBuiltFg: onAccent,
    badgeHeadlineBg: bgc(t.highlight),
    badgeHeadlineFg: onAccent,
    badgePhaseBg: bgc(t.border),
    badgePhaseFg: fgc(t.text) + ANSI.bold,
    badgeWarnBg: bgc(t.warning),
    badgeWarnFg: onAccent,
    badgeErrorBg: bgc(t.danger),
    badgeErrorFg: onAccent,
    badgeInfoBg: bgc(t.accent),
    badgeInfoFg: onAccent,

    statusBarBg: bgc(t.panel),
    statusBarFg: fgc(t.text),
    statusBarKeyBg: bgc(t.chip),
    statusBarKeyFg: fgc(t.accent) + ANSI.bold,
  };
}

/** Same shape as a colour theme, with every colour sequence empty. */
function buildMonoTheme(name: string, t: ThemeTokens): ThemeColors {
  const colored = buildTheme(name, t);
  const mono = Object.fromEntries(
    Object.keys(colored).map((key) => [key, '']),
  ) as unknown as ThemeColors;
  return { ...mono, name, mono: true, tokens: t, selectionBg: ANSI.inverse };
}

const THEME_LABELS: Record<ThemeName, string> = {
  cyber: 'Cyber',
  nord: 'Nord',
  catppuccin: 'Catppuccin',
  light: 'Light',
};

function buildAll(make: (name: string, t: ThemeTokens) => ThemeColors) {
  return Object.fromEntries(
    THEME_ORDER.map((key) => [key, make(THEME_LABELS[key], TOKENS[key])]),
  ) as Record<ThemeName, ThemeColors>;
}

/** 24-bit colour themes. */
export const THEMES: Record<ThemeName, ThemeColors> = buildAll((n, t) => buildTheme(n, t));
const THEMES_256 = buildAll((n, t) => buildTheme(n, t, '256'));
const MONO_THEMES = buildAll(buildMonoTheme);

let currentThemeName: ThemeName = DEFAULT_THEME;
let colorOverride: boolean | undefined;

/** Colour is on unless NO_COLOR is set to a non-empty value (or overridden). */
export function isColorEnabled(): boolean {
  if (colorOverride !== undefined) return colorOverride;
  const noColor = process.env.NO_COLOR;
  return noColor === undefined || noColor === '';
}

/** Force colour on or off. Pass undefined to go back to reading NO_COLOR. */
export function setColorEnabled(enabled: boolean | undefined): void {
  colorOverride = enabled;
}

export function getTheme(name?: ThemeName): ThemeColors {
  const key = name ?? currentThemeName;
  if (!isColorEnabled()) return MONO_THEMES[key]!;
  return getColorDepth() === 'truecolor' ? THEMES[key]! : THEMES_256[key]!;
}

/** Foreground colour for any hex value, at the current depth ('' with NO_COLOR). */
export function fgColor(hex: string): string {
  if (!isColorEnabled()) return '';
  return colorCode(hex, 38, getColorDepth());
}

export function setTheme(name: ThemeName): void {
  if (THEMES[name]) {
    currentThemeName = name;
  }
}

export function cycleTheme(): ThemeName {
  const nextIdx = (THEME_ORDER.indexOf(currentThemeName) + 1) % THEME_ORDER.length;
  currentThemeName = THEME_ORDER[nextIdx]!;
  return currentThemeName;
}

export function getCurrentThemeName(): ThemeName {
  return currentThemeName;
}
