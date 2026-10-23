/**
 * Busy indicator: "PROCESSING // <verb>" with animated dots, a ▰▱ progress
 * meter, the elapsed time ("02.4s") and a dim "[esc] abort" hint.
 * The panel form adds the animated SOA-BOT.
 */

import { ANSI, getTheme, type ThemeColors } from '../theme/theme.js';
import { renderBox, renderMeter } from '../theme/box.js';
import { visibleLength } from '../theme/text.js';
import { SOA_BOT_WIDTH, renderSoaBot } from './soa-bot.js';

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface BusyInfo {
  verb: string;
  elapsedMs: number;
  /** Animation frame counter. */
  frame: number;
  /** 0..1, how far along the task is. */
  progress?: number;
}

/** Elapsed time as "02.4s". */
export function formatElapsed(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1).padStart(4, '0')}s`;
}

function spinner(info: BusyInfo, theme: ThemeColors): string {
  return `${theme.accent}${SPINNER_FRAMES[info.frame % SPINNER_FRAMES.length]}${ANSI.reset}`;
}

/** "PROCESSING // Verifying memory.." with the dots padded so the width never jumps. */
function processing(info: BusyInfo, theme: ThemeColors): string {
  const dots = Math.floor(info.frame / 2) % 4;
  return (
    `${theme.accentSecondary}${ANSI.bold}PROCESSING //${ANSI.reset} ` +
    `${theme.fg}${ANSI.bold}${info.verb}${'.'.repeat(dots)}${' '.repeat(3 - dots)}${ANSI.reset}`
  );
}

function meter(info: BusyInfo, cells: number, theme: ThemeColors): string {
  return renderMeter(info.progress ?? 0, cells, theme);
}

function elapsed(info: BusyInfo, theme: ThemeColors): string {
  return `${theme.fgMuted}${formatElapsed(info.elapsedMs)}${ANSI.reset}`;
}

function abortHint(theme: ThemeColors): string {
  return `${theme.fgDim}[esc] abort${ANSI.reset}`;
}

/** One-line form for the status bar. */
export function renderBusyInline(info: BusyInfo, theme: ThemeColors = getTheme()): string {
  return [
    spinner(info, theme),
    processing(info, theme),
    meter(info, 5, theme),
    elapsed(info, theme),
    abortHint(theme),
  ].join(' ');
}

/** Boxed form with SOA-BOT, for the bottom-right overlay. */
export function renderBusyPanel(info: BusyInfo, theme: ThemeColors = getTheme()): string[] {
  const bot = renderSoaBot(info.frame, theme);
  const text = [
    '',
    `${spinner(info, theme)} ${processing(info, theme)}`,
    '',
    `  ${meter(info, 10, theme)}  ${elapsed(info, theme)}`,
    `  ${abortHint(theme)}`,
    '',
  ];
  const textWidth = Math.max(...text.map(visibleLength), 16);
  const lines = bot.map((row, i) => ` ${row}  ${text[i] ?? ''}`);
  return renderBox(lines, {
    width: SOA_BOT_WIDTH + textWidth + 6,
    title: 'SOA-BOT',
    style: 'hud',
    active: true,
    theme,
  }).split('\n');
}
