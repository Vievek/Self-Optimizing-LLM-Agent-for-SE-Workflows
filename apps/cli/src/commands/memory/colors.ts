import type { MemoryVerificationStatus } from '@soa/contracts';

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

/** Colour is on unless NO_COLOR is set to a non-empty value (https://no-color.org). */
export function colorEnabled(): boolean {
  const v = process.env['NO_COLOR'];
  return v === undefined || v === '';
}

function paint(code: string): (text: string) => string {
  return (text) => (colorEnabled() ? `${ESC}[${code}m${text}${ESC}[0m` : text);
}

export const green = paint('32');
export const red = paint('31');
export const yellow = paint('33');
export const blue = paint('34');
/** Dim grey, for secondary text. */
export const dim = paint('2;90');
export const bold = paint('1');

const STATUS_PAINT: Record<MemoryVerificationStatus, (text: string) => string> = {
  verified: green,
  stale: red,
  unverifiable: yellow,
  not_applicable: blue,
};

/** Colours `text` (default: the status itself) by verification status. */
export function colorStatus(status: MemoryVerificationStatus, text: string = status): string {
  return STATUS_PAINT[status](text);
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}
