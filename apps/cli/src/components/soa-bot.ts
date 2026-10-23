/**
 * SOA-BOT: a small robot head and shoulders.
 *
 *         ●            antenna tip blinks  · → o → ●
 *    ┏━━━━┻━━━━┓
 *    ┃  O   O  ┃       eyes blink now and then
 *    ┃ [━─────]┃       a scan bar sweeps left to right across the visor
 *    ┗━┳━━━━━┳━┛
 *   ╺━━┫[*.*]┣━━╸      chest panel lights flicker while it works
 *
 * 13 columns x 6 rows, 8 frames. Box-drawing and ASCII, plus the three antenna
 * tip characters (· o ●), all one column wide.
 */

import { ANSI, getTheme, type ThemeColors } from '../theme/theme.js';

export const SOA_BOT_WIDTH = 13;
export const SOA_BOT_HEIGHT = 6;

const ANTENNA = ['·', 'o', '●'];
/** Lit chest lights per frame ('*' on, '.' off). */
const CHEST = ['*.*', '.**', '*..', '..*', '**.', '.*.', '*.*', '***'];
const VISOR_CELLS = 7;

function buildFrame(frame: number): string[] {
  const tip = ANTENNA[frame % ANTENNA.length]!;
  const blink = frame === 5;
  const eyes = blink ? '  -   -  ' : '  O   O  ';
  // Frames 0-6 sweep the bar across the visor; frame 7 is the reset (no bar).
  const visor = Array.from({ length: VISOR_CELLS }, (_, i) => (i === frame ? '━' : '─')).join('');
  return [
    `      ${tip}      `,
    ' ┏━━━━┻━━━━┓ ',
    ` ┃${eyes}┃ `,
    ` ┃[${visor}]┃ `,
    ' ┗━┳━━━━━┳━┛ ',
    `╺━━┫[${CHEST[frame]}]┣━━╸`,
  ];
}

/** The eight plain-text animation frames (no colour). */
export const SOA_BOT_FRAMES: readonly string[][] = Array.from({ length: 8 }, (_, i) =>
  buildFrame(i),
);

const FRAME_CHARS = new Set(['┏', '┓', '┗', '┛', '━', '┃', '┻', '┳', '┫', '┣', '╺', '╸']);

function colorRow(row: string, rowIndex: number, theme: ThemeColors): string {
  return [...row]
    .map((ch) => {
      if (ch === ' ') return ch;
      let color = theme.fg;
      if (rowIndex === 0) color = ch === '●' ? theme.accentSecondary + ANSI.bold : theme.fgMuted;
      else if (rowIndex === 3 && ch === '━') color = theme.accentSecondary + ANSI.bold;
      else if (rowIndex === 3 && ch === '─') color = theme.fgDim;
      else if (FRAME_CHARS.has(ch)) color = theme.accent;
      else if (ch === 'O' || ch === '-') color = theme.fg + ANSI.bold;
      else if (ch === '*') color = theme.success + ANSI.bold;
      else if (ch === '.' || ch === '[' || ch === ']') color = theme.fgDim;
      return `${color}${ch}${ANSI.reset}`;
    })
    .join('');
}

/** Returns one coloured frame of SOA-BOT. `frame` wraps around. */
export function renderSoaBot(frame: number, theme: ThemeColors = getTheme()): string[] {
  const n = SOA_BOT_FRAMES.length;
  const lines = SOA_BOT_FRAMES[((frame % n) + n) % n]!;
  if (theme.mono) return [...lines];
  return lines.map((line, i) => colorRow(line, i, theme));
}
