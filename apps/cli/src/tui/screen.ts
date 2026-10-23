/**
 * Turns a rendered frame into the bytes written to the terminal, without
 * clearing the whole screen (which is what makes a TUI flicker).
 */

import { ANSI } from '../theme/theme.js';

/**
 * Builds the terminal update from the previous frame to the next one.
 *
 * - Without a previous frame (first paint, resize) every line is written,
 *   starting from the home position.
 * - Otherwise only the lines that changed are rewritten.
 * - Each written line is cleared to the end first (ESC[K) and the last line
 *   also clears everything below it (ESC[J). The clear comes before the text:
 *   lines are exactly as wide as the terminal, and clearing after the last
 *   column would erase that column in many terminals.
 * - The update is wrapped in synchronized-output markers, so terminals that
 *   support them paint it in one go. Others ignore the markers.
 *
 * Returns '' when nothing changed.
 */
export function renderFrameUpdate(
  prev: readonly string[] | undefined,
  next: readonly string[],
): string {
  const full = !prev || prev.length !== next.length;
  let body = '';
  next.forEach((line, i) => {
    if (!full && prev[i] === line) return;
    const clear = i === next.length - 1 ? ANSI.clearBelow : ANSI.clearLine;
    body += `\x1b[${i + 1};1H${clear}${line}`;
  });
  if (!body) return '';
  return ANSI.syncStart + (full ? ANSI.home : '') + body + ANSI.syncEnd;
}
