/**
 * Metric List Component
 *
 * Renders badge-value rows (e.g. [VERIFIED] 2, [STALE] 2). With a `total`,
 * each numeric value also gets a ▰▱ meter showing its share of the total.
 */

import { ANSI, getTheme, type ThemeColors } from '../theme/theme.js';
import { renderBadge, renderMeter, visibleLength, type BadgeVariant } from '../theme/box.js';

export interface MetricItem {
  badge: string;
  variant?: BadgeVariant;
  value: string | number;
}

export interface MetricListOptions {
  /** Draw a meter of value / total next to each numeric value. */
  total?: number;
}

const METER_CELLS = 6;

export function renderMetricList(
  items: MetricItem[],
  width = 36,
  theme: ThemeColors = getTheme(),
  options: MetricListOptions = {},
): string[] {
  return items.map((item) => {
    const badgeStr = renderBadge(item.badge, item.variant ?? 'built', theme);
    const valStr = String(item.value);
    const meter =
      options.total && typeof item.value === 'number'
        ? `${renderMeter(item.value / options.total, METER_CELLS, theme)} `
        : '';
    const spacing = Math.max(
      2,
      width - visibleLength(badgeStr) - visibleLength(meter) - visibleLength(valStr) - 4,
    );
    return `  ${badgeStr}${' '.repeat(spacing)}${meter}${theme.fg}${ANSI.bold}${valStr}${ANSI.reset}`;
  });
}
