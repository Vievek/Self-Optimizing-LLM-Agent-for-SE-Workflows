/**
 * Stage Card Component (termcn style)
 *
 * Renders a standardized pipeline stage or finding card with:
 * - Status check icon ([✔] or [ ])
 * - Title and badge ([BUILT], [HEADLINE], [NEXT PHASE], etc.)
 * - Subtext description
 * - Active / headline highlighting border
 */

import { ANSI, getTheme, type ThemeColors } from '../theme/theme.js';
import { renderBadge, renderBox, type BadgeVariant } from '../theme/box.js';

export interface StageCardProps {
  name: string;
  desc: string;
  done?: boolean;
  isHeadline?: boolean;
  badgeText: string;
  badgeVariant?: BadgeVariant;
  width?: number;
  theme?: ThemeColors;
}

export function renderStageCard(props: StageCardProps): string {
  const theme = props.theme ?? getTheme();
  const checkIcon = props.done
    ? `${theme.badgeBuiltBg} ✔ ${ANSI.reset}`
    : `${theme.fgDim} [ ] ${ANSI.reset}`;

  const badge = renderBadge(props.badgeText, props.badgeVariant ?? (props.done ? 'built' : 'phase'), theme);
  const titleLine = `  ${checkIcon}  ${theme.fg}${ANSI.bold}${props.name}${ANSI.reset}   ${badge}`;
  const descLine = `      ${theme.fgMuted}${props.desc}${ANSI.reset}`;

  return renderBox(['', titleLine, descLine, ''], {
    width: props.width,
    rounded: true,
    active: props.isHeadline,
    theme,
  });
}

