/**
 * Central CSS-like Theme File for SOA TUI
 *
 * All color tokens, box borders, badges, pill styles, and typography
 * are centralized in this single file. Any visual styling change across
 * the entire CLI application should be modified here.
 */

export type ThemeName = 'nord' | 'catppuccin' | 'light';

export interface ThemeColors {
  name: string;
  // Backgrounds & Base
  bg?: string;
  fg: string;
  fgMuted: string;
  fgDim: string;
  accent: string;
  accentSecondary: string;

  // Borders & Dividers
  border: string;
  borderActive: string;

  // Pills & Navigation Tabs
  tabActiveBg: string;
  tabActiveFg: string;
  tabInactiveBg: string;
  tabInactiveFg: string;

  // Badges & Status Indicators
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

  // Bottom Status Bar
  statusBarBg: string;
  statusBarFg: string;
  statusBarKeyBg: string;
  statusBarKeyFg: string;
}

// ANSI Escape Code Helpers
export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  clearScreen: '\x1b[2J\x1b[H',
  enterAltScreen: '\x1b[?1049h\x1b[H\x1b]50;Oxanium\x07',
  exitAltScreen: '\x1b[?1049l',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
};

// Available Themes (Nord, Catppuccin Mocha, Clean Light)
export const THEMES: Record<ThemeName, ThemeColors> = {
  nord: {
    name: 'Nord',
    fg: '\x1b[38;2;236;239;244m',          // #eceff4
    fgMuted: '\x1b[38;2;129;161;193m',     // #81a1c1
    fgDim: '\x1b[38;2;76;86;106m',         // #4c566a
    accent: '\x1b[38;2;136;192;208m',      // #88c0d0 Frost cyan
    accentSecondary: '\x1b[38;2;143;188;187m', // #8fbcbb Frost teal

    border: '\x1b[38;2;67;76;94m',         // #434c5e
    borderActive: '\x1b[38;2;136;192;208m', // #88c0d0

    tabActiveBg: '\x1b[48;2;67;76;94m',
    tabActiveFg: '\x1b[38;2;236;239;244m\x1b[1m',
    tabInactiveBg: '\x1b[48;2;46;52;64m',
    tabInactiveFg: '\x1b[38;2;129;161;193m',

    badgeBuiltBg: '\x1b[48;2;163;190;140m', // #a3be8c Nord green
    badgeBuiltFg: '\x1b[38;2;46;52;64m\x1b[1m',
    badgeHeadlineBg: '\x1b[48;2;180;142;173m', // #b48ead Nord purple
    badgeHeadlineFg: '\x1b[38;2;46;52;64m\x1b[1m',
    badgePhaseBg: '\x1b[48;2;59;66;82m',
    badgePhaseFg: '\x1b[38;2;216;222;233m\x1b[1m',
    badgeWarnBg: '\x1b[48;2;235;203;139m',  // #ebcb8b Nord yellow
    badgeWarnFg: '\x1b[38;2;46;52;64m\x1b[1m',
    badgeErrorBg: '\x1b[48;2;191;97;106m',  // #bf616a Nord red
    badgeErrorFg: '\x1b[38;2;236;239;244m\x1b[1m',
    badgeInfoBg: '\x1b[48;2;129;161;193m',  // #81a1c1 Nord blue
    badgeInfoFg: '\x1b[38;2;46;52;64m\x1b[1m',

    statusBarBg: '\x1b[48;2;59;66;82m',
    statusBarFg: '\x1b[38;2;216;222;233m',
    statusBarKeyBg: '\x1b[48;2;67;76;94m',
    statusBarKeyFg: '\x1b[38;2;136;192;208m\x1b[1m',
  },

  catppuccin: {
    name: 'Catppuccin',
    fg: '\x1b[38;2;205;214;244m',          // Text
    fgMuted: '\x1b[38;2;147;154;183m',     // Subtext0
    fgDim: '\x1b[38;2;108;112;134m',       // Overlay0
    accent: '\x1b[38;2;137;180;250m',      // Blue
    accentSecondary: '\x1b[38;2;180;190;254m', // Lavender

    border: '\x1b[38;2;88;91;112m',        // Surface2
    borderActive: '\x1b[38;2;137;180;250m',

    tabActiveBg: '\x1b[48;2;69;71;90m',
    tabActiveFg: '\x1b[38;2;205;214;244m\x1b[1m',
    tabInactiveBg: '\x1b[48;2;30;30;46m',
    tabInactiveFg: '\x1b[38;2;147;154;183m',

    badgeBuiltBg: '\x1b[48;2;166;227;161m', // Green
    badgeBuiltFg: '\x1b[38;2;17;17;27m\x1b[1m',
    badgeHeadlineBg: '\x1b[48;2;245;194;231m', // Pink
    badgeHeadlineFg: '\x1b[38;2;17;17;27m\x1b[1m',
    badgePhaseBg: '\x1b[48;2;49;50;68m',
    badgePhaseFg: '\x1b[38;2;205;214;244m\x1b[1m',
    badgeWarnBg: '\x1b[48;2;249;226;175m',  // Yellow
    badgeWarnFg: '\x1b[38;2;17;17;27m\x1b[1m',
    badgeErrorBg: '\x1b[48;2;243;139;168m', // Red
    badgeErrorFg: '\x1b[38;2;17;17;27m\x1b[1m',
    badgeInfoBg: '\x1b[48;2;137;220;235m',  // Sky
    badgeInfoFg: '\x1b[38;2;17;17;27m\x1b[1m',

    statusBarBg: '\x1b[48;2;49;50;68m',
    statusBarFg: '\x1b[38;2;205;214;244m',
    statusBarKeyBg: '\x1b[48;2;69;71;90m',
    statusBarKeyFg: '\x1b[38;2;137;180;250m\x1b[1m',
  },

  light: {
    name: 'Light',
    fg: '\x1b[38;2;44;53;64m',
    fgMuted: '\x1b[38;2;100;110;125m',
    fgDim: '\x1b[38;2;160;170;185m',
    accent: '\x1b[38;2;20;110;210m',
    accentSecondary: '\x1b[38;2;15;140;130m',

    border: '\x1b[38;2;195;205;215m',
    borderActive: '\x1b[38;2;20;110;210m',

    tabActiveBg: '\x1b[48;2;215;225;240m',
    tabActiveFg: '\x1b[38;2;15;75;150m\x1b[1m',
    tabInactiveBg: '\x1b[48;2;240;244;248m',
    tabInactiveFg: '\x1b[38;2;100;110;125m',

    badgeBuiltBg: '\x1b[48;2;190;230;190m',
    badgeBuiltFg: '\x1b[38;2;20;80;30m\x1b[1m',
    badgeHeadlineBg: '\x1b[48;2;230;200;240m',
    badgeHeadlineFg: '\x1b[38;2;90;20;100m\x1b[1m',
    badgePhaseBg: '\x1b[48;2;225;230;238m',
    badgePhaseFg: '\x1b[38;2;70;80;95m\x1b[1m',
    badgeWarnBg: '\x1b[48;2;255;235;185m',
    badgeWarnFg: '\x1b[38;2;130;85;10m\x1b[1m',
    badgeErrorBg: '\x1b[48;2;255;205;210m',
    badgeErrorFg: '\x1b[38;2;160;30;40m\x1b[1m',
    badgeInfoBg: '\x1b[48;2;210;230;255m',
    badgeInfoFg: '\x1b[38;2;15;70;140m\x1b[1m',

    statusBarBg: '\x1b[48;2;220;226;235m',
    statusBarFg: '\x1b[38;2;44;53;64m',
    statusBarKeyBg: '\x1b[48;2;200;210;222m',
    statusBarKeyFg: '\x1b[38;2;15;75;150m\x1b[1m',
  },
};

let currentThemeName: ThemeName = 'nord';

export function getTheme(name?: ThemeName): ThemeColors {
  return THEMES[name ?? currentThemeName]!;
}

export function setTheme(name: ThemeName): void {
  if (THEMES[name]) {
    currentThemeName = name;
  }
}

export function cycleTheme(): ThemeName {
  const order: ThemeName[] = ['nord', 'catppuccin', 'light'];
  const nextIdx = (order.indexOf(currentThemeName) + 1) % order.length;
  currentThemeName = order[nextIdx]!;
  return currentThemeName;
}

export function getCurrentThemeName(): ThemeName {
  return currentThemeName;
}

