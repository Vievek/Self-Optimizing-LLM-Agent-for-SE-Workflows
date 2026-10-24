/**
 * Layout helpers shared by every dashboard.
 *
 * Dashboards get their body size from `state.width` / `state.height` and use
 * these helpers to fill exactly that area: panels side by side on wide
 * terminals, stacked on narrow ones.
 */

import type { ThemeColors } from './theme.js';
import { renderBox } from './box.js';
import { fitWidth, sliceAnsi, visibleLength } from './text.js';

export const MIN_COLS = 80;
export const MIN_ROWS = 24;
/** At this width or more, panels are shown side by side. */
export const WIDE_BREAKPOINT = 120;

export function isWide(width: number): boolean {
  return width >= WIDE_BREAKPOINT;
}

/** Blank spacer rows: one on roomy terminals, none on short ones. */
export function spacer(height: number): string[] {
  return height >= 30 ? [''] : [];
}

/** Pads or cuts lines to exactly `width` x `height`. */
export function fitBlock(lines: string[], width: number, height: number): string[] {
  const out = lines.slice(0, Math.max(0, height)).map((line) => fitWidth(line, width));
  while (out.length < height) out.push(' '.repeat(Math.max(0, width)));
  return out;
}

/** Splits a multi-line string (or passes an array through). */
export function toLines(block: string | string[]): string[] {
  return typeof block === 'string' ? block.split('\n') : block;
}

/** Places blocks next to each other, each cut or padded to its column width. */
export function joinColumns(blocks: string[][], widths: number[], gap = 1): string[] {
  const rows = Math.max(0, ...blocks.map((b) => b.length));
  const gapStr = ' '.repeat(gap);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    out.push(blocks.map((b, j) => fitWidth(b[i] ?? '', widths[j] ?? 0)).join(gapStr));
  }
  return out;
}

/** Splits `total` columns into two widths by `ratio`, leaving `gap` between them. */
export function splitWidth(total: number, ratio: number, gap: number): [number, number] {
  const left = Math.floor((total - gap) * ratio);
  return [left, total - gap - left];
}

/** A vertical stack item: fixed lines, or a region that grows to fill free rows. */
export type StackItem = string[] | { grow: number; render: (height: number) => string[] };

/** Stacks items top to bottom; growing items share the rows left by fixed ones. */
export function vstack(items: StackItem[], width: number, height: number): string[] {
  const fixed = items.reduce((sum, item) => sum + (Array.isArray(item) ? item.length : 0), 0);
  const growItems = items.filter((item) => !Array.isArray(item)) as Array<{
    grow: number;
    render: (height: number) => string[];
  }>;
  const totalGrow = growItems.reduce((sum, item) => sum + item.grow, 0);
  let free = Math.max(0, height - fixed);

  const out: string[] = [];
  let seen = 0;
  for (const item of items) {
    if (Array.isArray(item)) {
      out.push(...item);
      continue;
    }
    seen++;
    const share = seen === growItems.length ? free : Math.floor((free * item.grow) / totalGrow);
    free -= share;
    out.push(...fitBlock(item.render(share), width, share));
  }
  return fitBlock(out, width, height);
}

/** Centres a block inside a width x height area. */
export function centerBlock(lines: string[], width: number, height: number): string[] {
  const blockWidth = Math.min(width, Math.max(0, ...lines.map(visibleLength)));
  const left = Math.max(0, Math.floor((width - blockWidth) / 2));
  const top = Math.max(0, Math.floor((height - lines.length) / 2));
  const shifted = lines.map((line) => ' '.repeat(left) + fitWidth(line, blockWidth));
  return fitBlock([...Array<string>(top).fill(''), ...shifted], width, height);
}

/** Draws `block` on top of `base` with its top-left corner at column x, row y. */
export function overlayBlock(base: string[], block: string[], x: number, y: number): string[] {
  const out = [...base];
  block.forEach((line, i) => {
    const row = y + i;
    if (row < 0 || row >= out.length) return;
    const target = out[row]!;
    const w = visibleLength(line);
    out[row] = sliceAnsi(target, 0, x) + line + sliceAnsi(target, x + w);
  });
  return out;
}

export interface PanelSpec {
  title?: string;
  badge?: string;
  active?: boolean;
  /** Builds the panel content for a given inner width. */
  build: (innerWidth: number) => string[];
  /** Content line range [start, end) to keep in view, e.g. the selected item. */
  focus?: [number, number];
  scrollOffset?: number;
}

/** Renders one panel at exactly width x height. */
export function renderPanel(
  spec: PanelSpec,
  width: number,
  height: number,
  theme: ThemeColors,
): string[] {
  if (height <= 0) return [];
  return renderBox(spec.build(Math.max(0, width - 2)), {
    width,
    height,
    title: spec.title,
    badge: spec.badge,
    active: spec.active,
    style: 'hud',
    scrollTo: spec.focus,
    scrollOffset: spec.scrollOffset,
    theme,
  }).split('\n');
}

export interface PanelsOptions {
  width: number;
  height: number;
  /** Share of the width for the left panel when side by side. */
  ratio: number;
  gap?: number;
  theme: ThemeColors;
}

/**
 * Two panels: side by side when the terminal is wide, stacked otherwise.
 * When stacked, the second panel keeps its natural height if there is room,
 * and is squeezed (or hidden) on short terminals.
 */
export function renderPanels(left: PanelSpec, right: PanelSpec, opts: PanelsOptions): string[] {
  const { width, height, theme } = opts;
  const gap = opts.gap ?? 1;

  if (isWide(width)) {
    const [lw, rw] = splitWidth(width, opts.ratio, gap);
    return joinColumns(
      [renderPanel(left, lw, height, theme), renderPanel(right, rw, height, theme)],
      [lw, rw],
      gap,
    );
  }

  const leftNatural = left.build(width - 2).length + 2;
  const rightNatural = right.build(width - 2).length + 2;
  let rightHeight: number;
  if (leftNatural + rightNatural <= height) {
    rightHeight = rightNatural;
  } else {
    rightHeight = Math.min(rightNatural, Math.max(3, Math.floor(height * 0.4)));
  }
  if (height - rightHeight < 3) rightHeight = 0;
  const leftHeight = height - rightHeight;

  return fitBlock(
    [
      ...renderPanel(left, width, leftHeight, theme),
      ...renderPanel(right, width, rightHeight, theme),
    ],
    width,
    height,
  );
}
