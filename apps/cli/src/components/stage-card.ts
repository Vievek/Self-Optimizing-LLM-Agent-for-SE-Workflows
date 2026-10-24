/**
 * Stage Card Component
 *
 * Renders a pipeline stage or finding card with:
 * - Status check icon ([✔] or [ ])
 * - Title and badge ([BUILT], [HEADLINE], [NEXT PHASE], etc.)
 * - Subtext description
 * - Accent border for headline or selected cards
 */

import { ANSI, getTheme, type ThemeColors } from '../theme/theme.js';
import { highlightRow, renderBadge, renderBox, type BadgeVariant } from '../theme/box.js';

export interface StageCardProps {
  name: string;
  desc: string;
  done?: boolean;
  isHeadline?: boolean;
  /** Selected in a list: accent border and highlighted title row. */
  selected?: boolean;
  badgeText: string;
  badgeVariant?: BadgeVariant;
  width?: number;
  theme?: ThemeColors;
}

/** Number of lines a stage card takes. */
export const STAGE_CARD_HEIGHT = 6;

export function renderStageCard(props: StageCardProps): string {
  const theme = props.theme ?? getTheme();
  const checkIcon = props.done
    ? `${theme.badgeBuiltBg}${theme.badgeBuiltFg} ✔ ${ANSI.reset}`
    : `${theme.fgDim} [ ] ${ANSI.reset}`;

  const badge = renderBadge(
    props.badgeText,
    props.badgeVariant ?? (props.done ? 'built' : 'phase'),
    theme,
  );
  let titleLine = `  ${checkIcon}  ${theme.fg}${ANSI.bold}${props.name}${ANSI.reset}   ${badge}`;
  const descLine = `      ${theme.fgMuted}${props.desc}${ANSI.reset}`;

  if (props.selected && props.width) {
    titleLine = highlightRow(titleLine, props.width - 2, theme);
  }

  return renderBox(['', titleLine, descLine, ''], {
    width: props.width,
    rounded: true,
    active: props.isHeadline || props.selected,
    theme,
  });
}
