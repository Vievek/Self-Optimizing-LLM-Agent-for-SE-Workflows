/**
 * Boot sequence splash: SOA-BOT, the block title, then status lines that type
 * out one by one and end with a green "[ OK ]".
 */

import { ANSI, getTheme, type ThemeColors } from '../theme/theme.js';
import { fitWidth, visibleLength } from '../theme/text.js';
import { centerBlock } from '../theme/layout.js';
import { renderSoaBot } from './soa-bot.js';
import { renderBlockTitle } from './block-title.js';

/** Total boot time. Any key skips it. */
export const BOOT_MS = 1500;
const FIRST_LINE_MS = 150;
const LINE_STEP_MS = 220;
const TYPE_MS = 150;
/** Column where the dot leader ends and "[ OK ]" starts. */
const LEADER_WIDTH = 46;

export const BOOT_SUBTITLE = 'SELF-OPTIMIZING SE AGENT // v0.1';

export interface BootInfo {
  /** Result of the contract health check, e.g. "5/5 valid". */
  contracts: string;
  /** Theme key shown in the SYNC line, e.g. "cyber". */
  themeKey: string;
}

export function bootLines(info: BootInfo): Array<[string, string]> {
  return [
    ['INIT', 'core runtime'],
    ['LOAD', `contracts · ${info.contracts}`],
    ['LINK', 'exec-core · heae · memory · orch'],
    ['SYNC', `theme: ${info.themeKey}`],
    ['READY', ''],
  ];
}

function renderBootLine(
  label: string,
  detail: string,
  progress: number,
  theme: ThemeColors,
): string {
  if (progress <= 0) return '';
  const full = `${label.padEnd(6)}${detail}`;
  const chars = [...full];
  if (progress < 1) {
    const typed = chars.slice(0, Math.max(1, Math.round(progress * chars.length))).join('');
    return `${theme.fg}${typed}${ANSI.reset}${theme.accent}_${ANSI.reset}`;
  }
  const head = `${theme.accent}${ANSI.bold}${label.padEnd(6)}${ANSI.reset}${theme.fg}${detail}${ANSI.reset}`;
  const leader = ' ' + '.'.repeat(Math.max(1, LEADER_WIDTH - chars.length - 1));
  return `${head}${theme.fgDim}${leader}${ANSI.reset} ${theme.success}${ANSI.bold}[ OK ]${ANSI.reset}`;
}

/** The whole boot screen at `elapsedMs`, centred in width x height. */
export function renderBootScreen(
  elapsedMs: number,
  frame: number,
  info: BootInfo,
  width: number,
  height: number,
  theme: ThemeColors = getTheme(),
): string[] {
  const lines = bootLines(info).map(([label, detail], i) => {
    const progress = (elapsedMs - FIRST_LINE_MS - i * LINE_STEP_MS) / TYPE_MS;
    return renderBootLine(label, detail, Math.min(1, progress), theme);
  });

  const blockWidth = LEADER_WIDTH + 7;
  const center = (line: string) => {
    const pad = Math.max(0, Math.floor((blockWidth - visibleLength(line)) / 2));
    return fitWidth(' '.repeat(pad) + line, blockWidth);
  };

  const block = [
    ...renderSoaBot(frame, theme).map(center),
    '',
    ...renderBlockTitle('SOA', blockWidth, theme).map(center),
    center(`${theme.fgMuted}${BOOT_SUBTITLE}${ANSI.reset}`),
    '',
    ...lines,
    '',
    center(`${theme.fgDim}press any key to skip${ANSI.reset}`),
  ];
  return centerBlock(block, width, height);
}
