/**
 * Split Layout / Two-Column Responsive Component (termcn style)
 *
 * Automatically splits available width, sizes left and right panels,
 * and merges them line-by-line with consistent spacing.
 */

import { getTheme, type ThemeColors } from '../theme/theme.js';
import { visibleLength } from '../theme/box.js';

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
  const ratio = options.ratio ?? 0.65;
  const gap = options.gap ?? 2;
  const leftWidth = Math.floor(options.width * ratio);
  const rightWidth = options.width - leftWidth - gap;

  const leftLines = leftBox.split('\n');
  const rightLines = rightBox.split('\n');
  const maxRows = Math.max(leftLines.length, rightLines.length);

  const out: string[] = [];
  const gapStr = ' '.repeat(gap);

  for (let i = 0; i < maxRows; i++) {
    const leftPart = leftLines[i] ?? '';
    const rightPart = rightLines[i] ?? '';

    const leftLen = visibleLength(leftPart);
    const leftPad = Math.max(0, leftWidth - leftLen);

    out.push(`${leftPart}${' '.repeat(leftPad)}${gapStr}${rightPart}`);
  }

  return out.join('\n');
}

