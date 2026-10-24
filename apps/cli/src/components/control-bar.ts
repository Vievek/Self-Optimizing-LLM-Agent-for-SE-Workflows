/**
 * Control Bar Component
 *
 * Renders the navigation row: theme selector pills (or a custom left badge)
 * and the view tab pills. When `width` is given and both halves do not fit on
 * one line, the tabs move to a second line.
 */

import { getTheme, type ThemeColors, type ThemeName } from '../theme/theme.js';
import { renderPill, sectionLabel } from '../theme/box.js';
import { visibleLength } from '../theme/text.js';

export interface ControlBarOptions {
  themeName: ThemeName;
  tabs?: string[];
  activeTab?: number;
  leftBadge?: string;
  theme?: ThemeColors;
  width?: number;
}

export function renderControlBar(options: ControlBarOptions): string {
  const theme = options.theme ?? getTheme(options.themeName);

  const leftSide =
    options.leftBadge ??
    [
      sectionLabel('Theme', theme),
      renderPill('Cyber', options.themeName === 'cyber', theme),
      renderPill('Catppuccin', options.themeName === 'catppuccin', theme),
      renderPill('Nord', options.themeName === 'nord', theme),
      renderPill('Light', options.themeName === 'light', theme),
    ].join(' ');

  let rightSide = '';
  if (options.tabs && options.tabs.length > 0) {
    const activeIdx = (options.activeTab ?? 0) % options.tabs.length;
    const tabPills = options.tabs.map((tab, idx) => renderPill(tab, idx === activeIdx, theme));
    rightSide = `${sectionLabel('Views', theme)} ${tabPills.join(' ')}`;
  }

  if (!rightSide) return leftSide;
  const oneLine = `${leftSide}     ${rightSide}`;
  if (options.width === undefined || visibleLength(oneLine) <= options.width) return oneLine;
  return `${leftSide}\n${rightSide}`;
}
