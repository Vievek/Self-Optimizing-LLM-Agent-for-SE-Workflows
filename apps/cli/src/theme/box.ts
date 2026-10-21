/**
 * Box & UI Component Primitives for TUI
 *
 * Provides rounded box drawing, pills, badges, tabs, and status lines.
 */

import { ANSI, getTheme, type ThemeColors } from './theme.js';

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

export function padText(text: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
  const len = visibleLength(text);
  if (len >= width) return text;
  const diff = width - len;
  if (align === 'right') return ' '.repeat(diff) + text;
  if (align === 'center') {
    const left = Math.floor(diff / 2);
    const right = diff - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  }
  return text + ' '.repeat(diff);
}

export interface BoxOptions {
  width?: number;
  title?: string;
  badge?: string;
  rounded?: boolean;
  active?: boolean;
  padY?: boolean;
  theme?: ThemeColors;
}

/**
 * Renders a framed box around content lines.
 */
export function renderBox(lines: string[], options: BoxOptions = {}): string {
  const theme = options.theme ?? getTheme();
  const rounded = options.rounded ?? true;
  const borderColor = options.active ? theme.borderActive : theme.border;

  const tl = rounded ? '╭' : '┌';
  const tr = rounded ? '╮' : '┐';
  const bl = rounded ? '╰' : '└';
  const br = rounded ? '╯' : '┘';
  const h = '─';
  const v = '│';

  const maxContentLen = lines.reduce((max, line) => Math.max(max, visibleLength(line)), 0);
  const minWidth = options.title ? visibleLength(options.title) + (options.badge ? visibleLength(options.badge) + 4 : 0) + 6 : 20;
  const innerWidth = Math.max(options.width ? options.width - 2 : 0, maxContentLen, minWidth);

  const out: string[] = [];

  // Top Border
  if (options.title) {
    const titleStr = ` ${theme.accent}${ANSI.bold}${options.title}${ANSI.reset} `;
    const badgeStr = options.badge ? ` ${options.badge} ` : '';
    const leftSpace = 2;
    const titleLen = visibleLength(titleStr) + visibleLength(badgeStr);
    const remainingH = Math.max(0, innerWidth - titleLen - leftSpace);
    out.push(
      `${borderColor}${tl}${h.repeat(leftSpace)}${ANSI.reset}${titleStr}${badgeStr}${borderColor}${h.repeat(remainingH)}${tr}${ANSI.reset}`,
    );
  } else {
    out.push(`${borderColor}${tl}${h.repeat(innerWidth)}${tr}${ANSI.reset}`);
  }

  // Optional top vertical padding inside box
  if (options.padY) {
    out.push(`${borderColor}${v}${' '.repeat(innerWidth)}${borderColor}${v}${ANSI.reset}`);
  }

  // Content Lines
  for (const line of lines) {
    const padding = Math.max(0, innerWidth - visibleLength(line));
    out.push(`${borderColor}${v}${ANSI.reset}${line}${' '.repeat(padding)}${borderColor}${v}${ANSI.reset}`);
  }

  // Optional bottom vertical padding inside box
  if (options.padY) {
    out.push(`${borderColor}${v}${' '.repeat(innerWidth)}${borderColor}${v}${ANSI.reset}`);
  }

  // Bottom Border
  out.push(`${borderColor}${bl}${h.repeat(innerWidth)}${br}${ANSI.reset}`);

  return out.join('\n');
}

/**
 * Renders a pill / button
 */
export function renderPill(label: string, active: boolean, theme: ThemeColors = getTheme()): string {
  if (active) {
    return `${theme.tabActiveBg}${theme.tabActiveFg}   ${label}   ${ANSI.reset}`;
  }
  return `${theme.tabInactiveBg}${theme.tabInactiveFg}  ${label}  ${ANSI.reset}`;
}

/**
 * Renders a colored status badge (e.g., [BUILT], [HEADLINE · BUILT], [NEXT PHASE])
 */
export type BadgeVariant = 'built' | 'headline' | 'phase' | 'warn' | 'error' | 'info';

export function renderBadge(label: string, variant: BadgeVariant = 'phase', theme: ThemeColors = getTheme()): string {
  switch (variant) {
    case 'built':
      return `${theme.badgeBuiltBg}${theme.badgeBuiltFg}  ${label}  ${ANSI.reset}`;
    case 'headline':
      return `${theme.badgeHeadlineBg}${theme.badgeHeadlineFg}  ${label}  ${ANSI.reset}`;
    case 'warn':
      return `${theme.badgeWarnBg}${theme.badgeWarnFg}  ${label}  ${ANSI.reset}`;
    case 'error':
      return `${theme.badgeErrorBg}${theme.badgeErrorFg}  ${label}  ${ANSI.reset}`;
    case 'info':
      return `${theme.badgeInfoBg}${theme.badgeInfoFg}  ${label}  ${ANSI.reset}`;
    case 'phase':
    default:
      return `${theme.badgePhaseBg}${theme.badgePhaseFg}  ${label}  ${ANSI.reset}`;
  }
}

/**
 * Renders the top title and metadata bar
 */
export function renderTopHeader(
  commandName: string,
  subtitle: string,
  badgeText = 'MOCK DATA · real TUI comes after integration',
  theme: ThemeColors = getTheme(),
  width = 96,
): string {
  const left = `${theme.accent}${ANSI.bold}$ ${commandName}${ANSI.reset}\n${theme.fgMuted}${subtitle}${ANSI.reset}`;
  const rightBadge = `${theme.border}${ANSI.bold}[ ${theme.badgeWarnFg}${theme.badgeWarnBg} ${badgeText} ${ANSI.reset}${theme.border} ]${ANSI.reset}`;

  const leftLines = left.split('\n');
  const padLen = Math.max(2, width - visibleLength(leftLines[0]!) - visibleLength(rightBadge));

  const firstLine = `${leftLines[0]}${' '.repeat(padLen)}${rightBadge}`;
  const secondLine = leftLines[1]!;

  return `${firstLine}\n${secondLine}`;
}

/**
 * Renders the bottom status bar with shortcuts
 */
export function renderStatusBar(
  context: string,
  shortcuts: Array<{ key: string; label: string }>,
  rightInfo: string,
  width = 96,
  theme: ThemeColors = getTheme(),
): string {
  const shortcutStrs = shortcuts.map(
    (s) => `${theme.statusBarKeyBg}${theme.statusBarKeyFg} ${s.key} ${ANSI.reset} ${theme.statusBarFg}${s.label}${ANSI.reset}`,
  );
  const center = shortcutStrs.join('  ');

  const leftStr = ` ${theme.accent}${ANSI.bold}${context}${ANSI.reset} `;
  const rightStr = ` ${theme.fgMuted}${rightInfo}${ANSI.reset} `;

  const innerLen = visibleLength(leftStr) + visibleLength(center) + visibleLength(rightStr);
  const padTotal = Math.max(2, width - innerLen);
  const padLeft = Math.floor(padTotal / 2);
  const padRight = padTotal - padLeft;

  const barContent = `${leftStr}${' '.repeat(padTotal > 0 ? padLeft : 1)}${center}${' '.repeat(padTotal > 0 ? padRight : 1)}${rightStr}`;
  return `${theme.statusBarBg}${barContent}${ANSI.reset}`;
}

/**
 * Responsive canvas centering helper.
 * On large/wide screens, centers the canvas both horizontally and vertically
 * so it fills the screen symmetrically rather than sticking in the top-left.
 */
export function centerCanvas(content: string, termWidth: number, termHeight?: number): string {
  const lines = content.split('\n');
  const maxLineLen = lines.reduce((max, l) => Math.max(max, visibleLength(l)), 0);

  // Horizontal centering
  let hPad = '';
  if (termWidth > maxLineLen + 2) {
    const hMargin = Math.max(0, Math.floor((termWidth - maxLineLen) / 2));
    hPad = ' '.repeat(hMargin);
  }

  const hCenteredLines = lines.map((line) => (line.trim().length === 0 ? line : hPad + line));

  // Vertical centering (only if terminal height is known and exceeds content height)
  if (termHeight && termHeight > lines.length + 2) {
    const vMargin = Math.max(0, Math.floor((termHeight - lines.length) / 2));
    return '\n'.repeat(vMargin) + hCenteredLines.join('\n');
  }

  return hCenteredLines.join('\n');
}

