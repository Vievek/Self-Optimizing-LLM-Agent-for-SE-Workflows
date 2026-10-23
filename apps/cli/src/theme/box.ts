/**
 * Box & UI component primitives for the TUI.
 *
 * Boxes (HUD panels with heavy corners, or rounded cards), pills, badges,
 * section labels, meters, header and bars.
 * When a width or height is given, the output is exactly that size: long
 * lines are cut with "…" and never wrap.
 */

import { ANSI, getTheme, type ThemeColors } from './theme.js';
import { fitWidth, keepStyle, truncate, visibleLength } from './text.js';

export { padText, stripAnsi, visibleLength } from './text.js';

export type BoxStyle = 'hud' | 'rounded' | 'square';

const CORNERS: Record<BoxStyle, [string, string, string, string]> = {
  hud: ['┏', '┓', '┗', '┛'],
  rounded: ['╭', '╮', '╰', '╯'],
  square: ['┌', '┐', '└', '┘'],
};

export interface BoxOptions {
  /** Exact outer width. Without it the box grows to fit its content. */
  width?: number;
  /** Exact outer height. Extra content is scrolled or cut, missing rows are blank. */
  height?: number;
  title?: string;
  badge?: string;
  rounded?: boolean;
  /**
   * Frame style. 'hud' has heavy corners (┏ ┓ ┗ ┛), thin sides and the title
   * set as "◢ TITLE ◣". Defaults to 'rounded' ('square' when rounded is false).
   */
  style?: BoxStyle;
  active?: boolean;
  padY?: boolean;
  theme?: ThemeColors;
  /** First content line to show when the content is taller than the box. */
  scrollOffset?: number;
  /** Content line range [start, end) that must stay visible (wins over scrollOffset). */
  scrollTo?: [number, number];
}

/** Renders a framed box around content lines. */
export function renderBox(lines: string[], options: BoxOptions = {}): string {
  const theme = options.theme ?? getTheme();
  const style: BoxStyle = options.style ?? (options.rounded === false ? 'square' : 'rounded');
  const borderColor = options.active ? theme.borderActive : theme.border;
  const [tl, tr, bl, br] = CORNERS[style];
  const h = '─';
  const v = '│';

  if (options.height !== undefined && options.height < 2) {
    const w = Math.max(0, options.width ?? 0);
    return Array.from({ length: Math.max(0, options.height) }, () => ' '.repeat(w)).join('\n');
  }

  let inner: number;
  if (options.width !== undefined) {
    inner = Math.max(0, options.width - 2);
  } else {
    const maxContentLen = lines.reduce((max, line) => Math.max(max, visibleLength(line)), 0);
    const minWidth = options.title
      ? visibleLength(options.title) + (options.badge ? visibleLength(options.badge) + 4 : 0) + 6
      : 20;
    inner = Math.max(maxContentLen, minWidth);
  }

  let content = options.padY ? ['', ...lines, ''] : [...lines];
  content = content.map((line) => fitWidth(line, inner));

  let hiddenAbove = false;
  let hiddenBelow = false;
  if (options.height !== undefined) {
    const rows = options.height - 2;
    if (content.length > rows) {
      let offset = options.scrollOffset ?? 0;
      if (options.scrollTo) {
        const [start, end] = options.scrollTo;
        if (end - offset > rows) offset = end - rows;
        if (start < offset) offset = start;
      }
      offset = Math.max(0, Math.min(offset, content.length - rows));
      hiddenAbove = offset > 0;
      hiddenBelow = offset + rows < content.length;
      content = content.slice(offset, offset + rows);
    }
    while (content.length < rows) content.push(' '.repeat(inner));
  }

  const out: string[] = [];

  // Top border, with the title (and badge) set into it.
  let label = '';
  if (options.title) {
    label =
      style === 'hud'
        ? ` ${theme.accent}${ANSI.bold}◢ ${options.title.toUpperCase()} ◣${ANSI.reset} `
        : ` ${theme.accent}${ANSI.bold}${options.title}${ANSI.reset} `;
    if (options.badge) label += `${options.badge} `;
    label = truncate(label, inner - 2);
  }
  if (label) {
    const rest = Math.max(0, inner - 1 - visibleLength(label));
    out.push(
      `${borderColor}${tl}${h}${ANSI.reset}${label}${borderColor}${h.repeat(rest)}${tr}${ANSI.reset}`,
    );
  } else {
    out.push(`${borderColor}${tl}${h.repeat(inner)}${tr}${ANSI.reset}`);
  }

  for (const line of content) {
    out.push(`${borderColor}${v}${ANSI.reset}${line}${borderColor}${v}${ANSI.reset}`);
  }

  // Bottom border, with a hint when part of the content is scrolled away.
  const hint = hiddenBelow ? ' ↓ more ' : hiddenAbove ? ' ↑ more ' : '';
  if (hint && inner >= hint.length + 2) {
    const left = inner - hint.length - 1;
    out.push(
      `${borderColor}${bl}${h.repeat(left)}${ANSI.reset}${theme.fgDim}${hint}${ANSI.reset}${borderColor}${h}${br}${ANSI.reset}`,
    );
  } else {
    out.push(`${borderColor}${bl}${h.repeat(inner)}${br}${ANSI.reset}`);
  }

  return out.join('\n');
}

/** A small "// SECTION" label in the accent colour. */
export function sectionLabel(text: string, theme: ThemeColors = getTheme()): string {
  return `${theme.accent}${ANSI.bold}// ${text.toUpperCase()}${ANSI.reset}`;
}

/** A meter like ▰▰▰▱▱ for a fraction between 0 and 1. */
export function renderMeter(
  fraction: number,
  cells: number,
  theme: ThemeColors = getTheme(),
  color: string = theme.accent,
): string {
  const filled = Math.max(0, Math.min(cells, Math.round(fraction * cells)));
  return `${color}${'▰'.repeat(filled)}${ANSI.reset}${theme.fgDim}${'▱'.repeat(cells - filled)}${ANSI.reset}`;
}

/** Paints a row with the theme's selection colour across exactly `width` columns. */
export function highlightRow(line: string, width: number, theme: ThemeColors = getTheme()): string {
  return keepStyle(fitWidth(line, width), theme.selectionBg + theme.selectionFg);
}

/** Renders a pill / tab. The active one is bold on the accent colour. */
export function renderPill(
  label: string,
  active: boolean,
  theme: ThemeColors = getTheme(),
): string {
  if (theme.mono) return active ? `${ANSI.bold}[${label}]${ANSI.reset}` : ` ${label} `;
  if (active) {
    return `${theme.tabActiveBg}${theme.tabActiveFg} ${label} ${ANSI.reset}`;
  }
  return `${theme.tabInactiveBg}${theme.tabInactiveFg} ${label} ${ANSI.reset}`;
}

/** Renders a coloured status badge (e.g. BUILT, HEADLINE · BUILT, NEXT PHASE). */
export type BadgeVariant = 'built' | 'headline' | 'phase' | 'warn' | 'error' | 'info';

export function renderBadge(
  label: string,
  variant: BadgeVariant = 'phase',
  theme: ThemeColors = getTheme(),
): string {
  if (theme.mono) return `[${label}]`;
  const [bg, fg] = {
    built: [theme.badgeBuiltBg, theme.badgeBuiltFg],
    headline: [theme.badgeHeadlineBg, theme.badgeHeadlineFg],
    warn: [theme.badgeWarnBg, theme.badgeWarnFg],
    error: [theme.badgeErrorBg, theme.badgeErrorFg],
    info: [theme.badgeInfoBg, theme.badgeInfoFg],
    phase: [theme.badgePhaseBg, theme.badgePhaseFg],
  }[variant];
  return `${bg}${fg} ${label} ${ANSI.reset}`;
}

/** Renders a small key badge, e.g. "[tab]". */
export function renderKey(key: string, theme: ThemeColors = getTheme()): string {
  if (theme.mono) return `[${key}]`;
  return `${theme.statusBarKeyBg}${theme.statusBarKeyFg} ${key} ${ANSI.reset}`;
}

/** Renders the two-line dashboard title: command + badge, then the subtitle. */
export function renderTopHeader(
  commandName: string,
  subtitle: string,
  badgeText = 'MOCK DATA · real TUI comes after integration',
  theme: ThemeColors = getTheme(),
  width = 96,
): string {
  const left = `${theme.accent}${ANSI.bold}$ ${commandName}${ANSI.reset}`;
  const right = `${theme.fgDim}[${ANSI.reset}${renderBadge(badgeText, 'warn', theme)}${theme.fgDim}]${ANSI.reset}`;
  const gap = Math.max(2, width - visibleLength(left) - visibleLength(right));
  const firstLine = fitWidth(`${left}${' '.repeat(gap)}${right}`, width);
  const secondLine = fitWidth(`${theme.fgMuted}${subtitle}${ANSI.reset}`, width);
  return `${firstLine}\n${secondLine}`;
}

/**
 * Renders a one-line bar: `left` and `right` at the edges, `middle` centred in
 * between (and cut first when space runs out). Always exactly `width` wide.
 */
export function renderBar(
  left: string,
  middle: string,
  right: string,
  width: number,
  theme: ThemeColors = getTheme(),
): string {
  const rightFit = truncate(right, width);
  const leftFit = truncate(left, Math.max(0, width - visibleLength(rightFit)));
  const space = width - visibleLength(leftFit) - visibleLength(rightFit);
  const mid = truncate(middle, Math.max(0, space - 2));
  const padLeft = Math.floor((space - visibleLength(mid)) / 2);
  const padRight = space - visibleLength(mid) - padLeft;
  const line = fitWidth(
    `${leftFit}${' '.repeat(padLeft)}${mid}${' '.repeat(padRight)}${rightFit}`,
    width,
  );
  return keepStyle(line, theme.statusBarBg + theme.statusBarFg);
}

/** Renders a status bar with key shortcuts. Always exactly `width` wide. */
export function renderStatusBar(
  context: string,
  shortcuts: Array<{ key: string; label: string }>,
  rightInfo: string,
  width = 96,
  theme: ThemeColors = getTheme(),
): string {
  const keys = shortcuts
    .map((s) => `${renderKey(s.key, theme)} ${theme.fgMuted}${s.label}${ANSI.reset}`)
    .join('  ');
  const left = ` ${theme.accent}${ANSI.bold}${context}${ANSI.reset} `;
  const right = ` ${theme.fgMuted}${rightInfo}${ANSI.reset} `;
  return renderBar(left, keys, right, width, theme);
}

/**
 * Centres content in a terminal area.
 * Kept for API compatibility; the full-screen app no longer uses it.
 */
export function centerCanvas(content: string, termWidth: number, termHeight?: number): string {
  const lines = content.split('\n');
  const maxLineLen = lines.reduce((max, l) => Math.max(max, visibleLength(l)), 0);
  const hPad =
    termWidth > maxLineLen + 2 ? ' '.repeat(Math.floor((termWidth - maxLineLen) / 2)) : '';
  const centered = lines.map((line) => (line.trim().length === 0 ? line : hPad + line));
  if (termHeight && termHeight > lines.length + 2) {
    return '\n'.repeat(Math.floor((termHeight - lines.length) / 2)) + centered.join('\n');
  }
  return centered.join('\n');
}
