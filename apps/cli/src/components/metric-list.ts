/**
 * Metric List Component (termcn style)
 *
 * Renders structured badge-value rows (e.g. [VERIFIED] 2, [STALE] 2)
 */

import { ANSI, getTheme, type ThemeColors } from '../theme/theme.js';
import { renderBadge, visibleLength, type BadgeVariant } from '../theme/box.js';

export interface MetricItem {
  badge: string;
  variant?: BadgeVariant;
  value: string | number;
}

export function renderMetricList(items: MetricItem[], width = 36, theme: ThemeColors = getTheme()): string[] {
  return items.map((item) => {
    const badgeStr = renderBadge(item.badge, item.variant ?? 'built', theme);
    const valStr = String(item.value);
    const spacing = Math.max(2, width - visibleLength(badgeStr) - visibleLength(valStr) - 4);
    return `  ${badgeStr}${' '.repeat(spacing)}${theme.fg}${ANSI.bold}${valStr}${ANSI.reset}`;
  });
}

