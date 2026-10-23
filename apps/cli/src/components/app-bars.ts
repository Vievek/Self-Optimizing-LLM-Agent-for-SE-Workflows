/**
 * The app's fixed top bar and bottom status bar.
 */

import { ANSI, getTheme, type ThemeColors } from '../theme/theme.js';
import { renderBar, renderKey, renderPill } from '../theme/box.js';
import { visibleLength } from '../theme/text.js';

export const MODULE_TABS = [
  { key: '1', id: 'exec', label: 'Exec' },
  { key: '2', id: 'heae', label: 'HEAE' },
  { key: '3', id: 'memory', label: 'Memory' },
  { key: '4', id: 'orch', label: 'Orch' },
] as const;

const EXTRA_VIEW_LABELS: Record<string, string> = { menu: 'Menu', help: 'Help' };

export interface TopBarOptions {
  activeView: string;
  /** Name of the active view, e.g. "Memory Agent". */
  viewName?: string;
  width: number;
  /** While busy the status dot pulses. */
  busy?: boolean;
  /** Animation frame counter (drives the pulse). */
  frame?: number;
  theme?: ThemeColors;
}

/** "◤ SOA // MEMORY AGENT ◥"   1 Exec · 2 HEAE · 3 Memory · 4 Orch   "SYS ONLINE ●". */
export function renderTopBar(options: TopBarOptions): string {
  const theme = options.theme ?? getTheme();
  const wide = options.width >= 120;

  // Short module label on narrow terminals so the tabs keep their room.
  const tab = MODULE_TABS.find((t) => t.id === options.activeView);
  const fullName = options.viewName ?? tab?.label ?? options.activeView;
  const name = (
    wide ? fullName : (tab?.label ?? EXTRA_VIEW_LABELS[options.activeView] ?? fullName)
  ).toUpperCase();
  const left =
    ` ${theme.accent}${ANSI.bold}◤ SOA${ANSI.reset}${theme.fgDim} // ${ANSI.reset}` +
    `${theme.fg}${ANSI.bold}${name}${ANSI.reset} ${theme.accent}${ANSI.bold}◥${ANSI.reset} `;

  const sep = `${theme.fgDim}·${ANSI.reset}`;
  const tabs = MODULE_TABS.map((t) => {
    const label = `${t.key} ${t.label}`;
    return t.id === options.activeView
      ? renderPill(label, true, theme)
      : `${theme.fgMuted} ${label} ${ANSI.reset}`;
  }).join(sep);
  const extra = EXTRA_VIEW_LABELS[options.activeView];
  const middle = `${tabs}${extra ? `  ${renderPill(extra, true, theme)}` : ''}`;

  // The dot pulses (bright / dim) only while busy.
  const pulseDim = options.busy && Math.floor((options.frame ?? 0) / 3) % 2 === 1;
  const dot = pulseDim
    ? `${theme.fgDim}●${ANSI.reset}`
    : `${theme.success}${ANSI.bold}●${ANSI.reset}`;
  const themeTag = wide ? `${theme.fgDim}${theme.name.toUpperCase()} │ ${ANSI.reset}` : '';
  const right = `${themeTag}${theme.fgMuted}SYS ONLINE${ANSI.reset} ${dot} `;

  return renderBar(left, middle, right, options.width, theme);
}

export interface KeyHint {
  key: string;
  label: string;
  /** Higher numbers stay visible longer when the bar is narrow. */
  priority: number;
}

export interface StatusLineOptions {
  hints: KeyHint[];
  message: string;
  time: string;
  width: number;
  theme?: ThemeColors;
}

function renderHints(hints: KeyHint[], theme: ThemeColors): string {
  return hints
    .map((h) => `${renderKey(h.key, theme)} ${theme.fgMuted}${h.label}${ANSI.reset}`)
    .join('  ');
}

/** Key hints on the left, a status message in the middle, the time on the right. */
export function renderStatusLine(options: StatusLineOptions): string {
  const theme = options.theme ?? getTheme();
  const right = ` ${theme.fgMuted}${options.time}${ANSI.reset} `;
  // The status message gets the room it needs (at least 22 columns); the
  // least important key hints are dropped first to make space.
  const messageRoom = Math.max(22, visibleLength(options.message) + 4);
  const budget = options.width - visibleLength(right) - messageRoom;

  let hints = [...options.hints];
  while (hints.length > 1 && visibleLength(renderHints(hints, theme)) + 1 > budget) {
    const lowest = Math.min(...hints.map((h) => h.priority));
    const dropAt = hints.map((h) => h.priority).lastIndexOf(lowest);
    hints = hints.filter((_, i) => i !== dropAt);
  }

  return renderBar(` ${renderHints(hints, theme)}`, options.message, right, options.width, theme);
}
