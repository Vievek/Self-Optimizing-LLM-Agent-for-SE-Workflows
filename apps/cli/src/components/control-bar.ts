/**
 * Control Bar Component (termcn style)
 *
 * Renders the top navigation row containing theme selector pills,
 * active model indicators, and view tab switchers.
 */

import { getTheme, type ThemeColors, type ThemeName } from '../theme/theme.js';
import { renderPill } from '../theme/box.js';

export interface ControlBarOptions {
  themeName: ThemeName;
  tabs?: string[];
  activeTab?: number;
  leftBadge?: string;
  theme?: ThemeColors;
}

export function renderControlBar(options: ControlBarOptions): string {
  const theme = options.theme ?? getTheme(options.themeName);

  // Left side: Theme selector pills (or custom badge if provided)
  let leftSide = '';
  if (options.leftBadge) {
    leftSide = options.leftBadge;
  } else {
    leftSide = [
      'Theme',
      renderPill('Catppuccin', options.themeName === 'catppuccin', theme),
      renderPill('Nord', options.themeName === 'nord', theme),
      renderPill('Light', options.themeName === 'light', theme),
    ].join('   ');
  }

  // Right side: View tabs
  let rightSide = '';
  if (options.tabs && options.tabs.length > 0) {
    const activeIdx = (options.activeTab ?? 0) % options.tabs.length;
    const tabPills = options.tabs.map((tab, idx) => renderPill(tab, idx === activeIdx, theme));
    rightSide = `Views     ${tabPills.join('   ')}`;
  }

  if (!rightSide) return leftSide;
  return `${leftSide}     ${rightSide}`;
}

