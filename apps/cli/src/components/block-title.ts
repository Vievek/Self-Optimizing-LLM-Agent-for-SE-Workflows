/**
 * Block-letter titles: a hand-made 5-row font built from █ ▀ ▄ and spaces.
 *
 * renderBlockTitle("SOA", maxWidth) gives the big letters when they fit, and
 * falls back to spaced capitals ("S O A") when they do not.
 */

import { ANSI, fgColor, getTheme, type ThemeColors } from '../theme/theme.js';

export const BLOCK_FONT_HEIGHT = 5;

/** Glyphs are 5 columns wide (space is 3). */
export const BLOCK_FONT: Record<string, string[]> = {
  A: ['▄███▄', '█   █', '█████', '█   █', '█   █'],
  B: ['████▄', '█   █', '████▄', '█   █', '████▀'],
  C: ['▄████', '█    ', '█    ', '█    ', '▀████'],
  D: ['████▄', '█   █', '█   █', '█   █', '████▀'],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  F: ['█████', '█    ', '████ ', '█    ', '█    '],
  G: ['▄████', '█    ', '█  ██', '█   █', '▀███▀'],
  H: ['█   █', '█   █', '█████', '█   █', '█   █'],
  I: ['█████', '  █  ', '  █  ', '  █  ', '█████'],
  J: ['  ███', '    █', '    █', '█   █', '▀███▀'],
  K: ['█   █', '█  █ ', '███  ', '█  █ ', '█   █'],
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  M: ['█▄ ▄█', '█ ▀ █', '█   █', '█   █', '█   █'],
  N: ['█▄  █', '█▀▄ █', '█ ▀▄█', '█  ▀█', '█   █'],
  O: ['▄███▄', '█   █', '█   █', '█   █', '▀███▀'],
  P: ['████▄', '█   █', '████▀', '█    ', '█    '],
  Q: ['▄███▄', '█   █', '█   █', '█  ▀▄', '▀██▀█'],
  R: ['████▄', '█   █', '████▀', '█  ▀▄', '█   █'],
  S: ['▄████', '█    ', '▀███▄', '    █', '████▀'],
  T: ['█████', '  █  ', '  █  ', '  █  ', '  █  '],
  U: ['█   █', '█   █', '█   █', '█   █', '▀███▀'],
  V: ['█   █', '█   █', '█   █', '▀▄ ▄▀', ' ▀█▀ '],
  W: ['█   █', '█   █', '█ ▄ █', '█▀ ▀█', '▀   ▀'],
  X: ['█   █', '▀▄ ▄▀', ' ▄█▄ ', '█▀ ▀█', '█   █'],
  Y: ['█   █', '▀▄ ▄▀', ' ▀█▀ ', '  █  ', '  █  '],
  Z: ['█████', '   ▄▀', ' ▄▀  ', '█    ', '█████'],
  '0': ['▄███▄', '█  ▄█', '█ █ █', '█▀  █', '▀███▀'],
  '1': [' ▄█  ', '▀ █  ', '  █  ', '  █  ', '█████'],
  '2': ['▄███▄', '    █', ' ▄▄▄▀', '█    ', '█████'],
  '3': ['████▄', '    █', ' ███ ', '    █', '████▀'],
  '4': ['█   █', '█   █', '█████', '    █', '    █'],
  '5': ['█████', '█    ', '████▄', '    █', '████▀'],
  '6': ['▄███▄', '█    ', '████▄', '█   █', '▀███▀'],
  '7': ['█████', '    █', '   ▄▀', '  █  ', '  █  '],
  '8': ['▄███▄', '█   █', '▄███▄', '█   █', '▀███▀'],
  '9': ['▄███▄', '█   █', '▀████', '    █', '▀███▀'],
  '-': ['     ', '     ', '████ ', '     ', '     '],
  ' ': ['   ', '   ', '   ', '   ', '   '],
};

const LETTER_GAP = ' ';

function glyph(ch: string): string[] {
  return BLOCK_FONT[ch] ?? BLOCK_FONT[' ']!;
}

/** Plain block lines (no colour). */
export function blockLines(text: string): string[] {
  const glyphs = [...text.toUpperCase()].map(glyph);
  return Array.from({ length: BLOCK_FONT_HEIGHT }, (_, row) =>
    glyphs.map((g) => g[row]!).join(LETTER_GAP),
  );
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const channel = (shift: number) => {
    const x = (pa >> shift) & 255;
    const y = (pb >> shift) & 255;
    return Math.round(x + (y - x) * t);
  };
  const value = (channel(16) << 16) | (channel(8) << 8) | channel(0);
  return `#${value.toString(16).padStart(6, '0')}`;
}

/**
 * Big block letters faded top to bottom from the accent (cyan) to the
 * secondary accent (magenta), one colour per row. When the letters are wider
 * than `maxWidth`, returns one line of spaced capitals instead ("S O A").
 */
export function renderBlockTitle(
  text: string,
  maxWidth: number,
  theme: ThemeColors = getTheme(),
): string[] {
  const lines = blockLines(text);
  if ([...lines[0]!].length > maxWidth) {
    const plain = [...text.toUpperCase()].join(' ');
    return [`${theme.accent}${ANSI.bold}${plain}${ANSI.reset}`];
  }
  if (theme.mono) return lines;
  return lines.map((line, row) => {
    const color = fgColor(mix(theme.tokens.accent, theme.tokens.accent2, row / (lines.length - 1)));
    return `${color}${line}${ANSI.reset}`;
  });
}
