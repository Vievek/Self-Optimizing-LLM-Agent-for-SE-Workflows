import { describe, expect, it } from 'vitest';
import { SOA_BOT_FRAMES, SOA_BOT_HEIGHT, SOA_BOT_WIDTH, renderSoaBot } from './soa-bot.js';
import { BLOCK_FONT, BLOCK_FONT_HEIGHT, blockLines, renderBlockTitle } from './block-title.js';
import { formatElapsed, renderBusyInline, renderBusyPanel } from './busy-indicator.js';
import { THEMES } from '../theme/theme.js';
import { stripAnsi } from '../theme/text.js';

const width = (line: string) => [...stripAnsi(line)].length;

describe('SOA-BOT', () => {
  it('has 8 frames, all with identical width and height', () => {
    expect(SOA_BOT_FRAMES).toHaveLength(8);
    for (const frame of SOA_BOT_FRAMES) {
      expect(frame).toHaveLength(SOA_BOT_HEIGHT);
      for (const line of frame) expect(width(line)).toBe(SOA_BOT_WIDTH);
    }
  });

  it('uses only box-drawing, ASCII and the antenna tip characters', () => {
    for (const ch of SOA_BOT_FRAMES.flat().join('')) {
      const code = ch.codePointAt(0)!;
      const ok =
        (code >= 0x20 && code < 0x7f) || (code >= 0x2500 && code <= 0x257f) || '·●'.includes(ch);
      expect(ok, `unexpected character "${ch}"`).toBe(true);
    }
  });

  it('animates the antenna, scan bar, eyes and chest lights', () => {
    const rows = (i: number) => SOA_BOT_FRAMES.map((f) => f[i]);
    expect(new Set(rows(0).map((r) => r!.trim()))).toEqual(new Set(['·', 'o', '●']));
    // The scan bar moves left to right across the visor.
    const barPositions = rows(3).map((r) => r!.indexOf('━'));
    expect(barPositions.slice(0, 7)).toEqual([...barPositions.slice(0, 7)].sort((a, b) => a - b));
    expect(new Set(barPositions).size).toBeGreaterThan(5);
    expect(rows(2).some((r) => r!.includes('-   -'))).toBe(true);
    expect(rows(2).some((r) => r!.includes('O   O'))).toBe(true);
    expect(new Set(rows(5)).size).toBeGreaterThan(4);
  });

  it('keeps the same width when coloured', () => {
    for (let i = 0; i < 16; i++) {
      for (const line of renderSoaBot(i, THEMES.cyber)) expect(width(line)).toBe(SOA_BOT_WIDTH);
    }
  });
});

describe('Block title', () => {
  it('has 5-row glyphs of equal width for A-Z, 0-9, space and "-"', () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -';
    for (const ch of chars) {
      const glyph = BLOCK_FONT[ch]!;
      expect(glyph, ch).toHaveLength(BLOCK_FONT_HEIGHT);
      expect(new Set(glyph.map((row) => [...row].length)).size, ch).toBe(1);
      for (const c of glyph.join('')) expect(' █▀▄'.includes(c), `${ch}: "${c}"`).toBe(true);
    }
  });

  it('renders block letters when they fit', () => {
    const lines = renderBlockTitle('SOA', 80, THEMES.cyber);
    expect(lines).toHaveLength(5);
    expect(lines.map(stripAnsi)).toEqual(blockLines('SOA'));
    // One colour per row (cyan to magenta fade).
    expect(new Set(lines.map((l) => l.slice(0, l.indexOf('m') + 1))).size).toBe(5);
  });

  it('falls back to spaced capitals when maxWidth is too small', () => {
    const lines = renderBlockTitle('soa', 10, THEMES.cyber);
    expect(lines).toHaveLength(1);
    expect(stripAnsi(lines[0]!)).toBe('S O A');
  });
});

describe('Busy indicator', () => {
  it('shows PROCESSING // verb, a meter, the elapsed time and [esc] abort', () => {
    const line = stripAnsi(
      renderBusyInline(
        { verb: 'Verifying memory', elapsedMs: 2400, frame: 0, progress: 0.6 },
        THEMES.cyber,
      ),
    );
    expect(line).toContain('PROCESSING // Verifying memory');
    expect(line).toContain('▰▰▰▱▱');
    expect(line).toContain('02.4s');
    expect(line).toContain('[esc] abort');
  });

  it('formats elapsed time as 00.0s', () => {
    expect(formatElapsed(0)).toBe('00.0s');
    expect(formatElapsed(2400)).toBe('02.4s');
    expect(formatElapsed(12345)).toBe('12.3s');
  });

  it('keeps the panel width stable across frames', () => {
    const widths = new Set<number>();
    for (let frame = 0; frame < 16; frame++) {
      const panel = renderBusyPanel(
        { verb: 'Re-checking commit', elapsedMs: frame * 120, frame, progress: frame / 16 },
        THEMES.cyber,
      );
      for (const line of panel) widths.add(width(line));
    }
    expect(widths.size).toBe(1);
  });
});
