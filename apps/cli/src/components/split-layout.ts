/**
 * Split Layout / Two-Column Component
 *
 * Splits the available width by `ratio` and merges two blocks line by line.
 * Every output line is exactly `width` columns wide.
 */

import type { ThemeColors } from '../theme/theme.js';
import { joinColumns, splitWidth, toLines } from '../theme/layout.js';

export interface SplitLayoutOptions {
  width: number;
  ratio?: number; // e.g. 0.68 for 68% left, 32% right
  gap?: number;
  theme?: ThemeColors;
}

export function renderSplitLayout(
  leftBox: string,
  rightBox: string,
  options: SplitLayoutOptions,
): string {
  const gap = options.gap ?? 2;
  const [leftWidth, rightWidth] = splitWidth(options.width, options.ratio ?? 0.65, gap);
  return joinColumns([toLines(leftBox), toLines(rightBox)], [leftWidth, rightWidth], gap).join(
    '\n',
  );
}
