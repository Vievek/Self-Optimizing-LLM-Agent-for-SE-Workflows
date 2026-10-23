/**
 * ANSI-aware text helpers.
 *
 * Every width here is measured in visible terminal columns, with escape codes
 * ignored. Characters are counted per code point, so keep content to
 * single-width characters (box drawing, ASCII and simple symbols).
 */

export const RESET = '\x1b[0m';

/* eslint-disable no-control-regex */
const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
const TOKEN_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|[\s\S]/gu;
/* eslint-enable no-control-regex */

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export function visibleLength(text: string): number {
  return [...stripAnsi(text)].length;
}

function isEscape(token: string): boolean {
  return token.length > 1 && token.charCodeAt(0) === 27;
}

/**
 * Returns the visible columns [start, end) of `text`, keeping the colours that
 * were active at `start`. A reset is appended when any escape code is kept,
 * unless `closeWithReset` is false.
 */
export function sliceAnsi(
  text: string,
  start: number,
  end = Number.POSITIVE_INFINITY,
  closeWithReset = true,
): string {
  let col = 0;
  let out = '';
  let pending = '';
  let usedEscape = false;

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    if (isEscape(token)) {
      if (col < start) {
        pending = token === RESET ? '' : pending + token;
      } else if (col < end) {
        out += token;
        usedEscape = true;
      }
      continue;
    }
    if (col >= end) break;
    if (col >= start) {
      if (pending) {
        out += pending;
        pending = '';
        usedEscape = true;
      }
      out += token;
    }
    col++;
  }

  return usedEscape && closeWithReset ? out + RESET : out;
}

/** Cuts text to `width` columns, ending with "…" when anything was removed. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  if (visibleLength(text) <= width) return text;
  const head = sliceAnsi(text, 0, width - 1, false);
  return `${head}…${head.includes('\x1b') ? RESET : ''}`;
}

/** Pads or truncates text to exactly `width` visible columns. */
export function fitWidth(text: string, width: number): string {
  if (width <= 0) return '';
  const len = visibleLength(text);
  if (len > width) return truncate(text, width);
  return text + ' '.repeat(width - len);
}

export function padText(
  text: string,
  width: number,
  align: 'left' | 'right' | 'center' = 'left',
): string {
  const len = visibleLength(text);
  if (len >= width) return text;
  const diff = width - len;
  if (align === 'right') return ' '.repeat(diff) + text;
  if (align === 'center') {
    const left = Math.floor(diff / 2);
    return ' '.repeat(left) + text + ' '.repeat(diff - left);
  }
  return text + ' '.repeat(diff);
}

/** Re-applies `style` after every reset so a background survives inner colour changes. */
export function keepStyle(text: string, style: string): string {
  if (!style) return text;
  return style + text.split(RESET).join(RESET + style) + RESET;
}
