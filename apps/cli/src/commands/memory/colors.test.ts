import { afterEach, describe, expect, it } from 'vitest';
import { colorStatus, dim, stripAnsi } from './colors.js';
import { renderStatusTable } from './shared.js';

const saved = process.env['NO_COLOR'];
afterEach(() => {
  if (saved === undefined) delete process.env['NO_COLOR'];
  else process.env['NO_COLOR'] = saved;
});

describe('colour helper', () => {
  it('colours each status: green, red, yellow, blue; dim grey for secondary text', () => {
    delete process.env['NO_COLOR'];
    expect(colorStatus('verified')).toBe('\u001b[32mverified\u001b[0m');
    expect(colorStatus('stale')).toBe('\u001b[31mstale\u001b[0m');
    expect(colorStatus('unverifiable')).toBe('\u001b[33munverifiable\u001b[0m');
    expect(colorStatus('not_applicable', 'n/a')).toBe('\u001b[34mn/a\u001b[0m');
    expect(dim('x')).toBe('\u001b[2;90mx\u001b[0m');
    expect(stripAnsi(colorStatus('stale'))).toBe('stale');
  });

  it('respects NO_COLOR, but only when it is non-empty', () => {
    process.env['NO_COLOR'] = '1';
    expect(colorStatus('verified')).toBe('verified');
    expect(dim('x')).toBe('x');
    process.env['NO_COLOR'] = '';
    expect(colorStatus('verified')).toContain('\u001b[32m');
  });
});

describe('renderStatusTable', () => {
  it('colours only the status cells and keeps the columns aligned', () => {
    delete process.env['NO_COLOR'];
    const out = renderStatusTable(
      ['ID', 'Status', 'N'],
      [
        ['a', 'verified', 1],
        ['bbbb', 'stale', 22],
      ],
      1,
      ['verified', 'stale'],
      'T',
    );
    expect(out).toContain('| a    | \u001b[32mverified\u001b[0m | 1  |');
    expect(out).toContain('| bbbb | \u001b[31mstale\u001b[0m    | 22 |');
    const widths = new Set(
      stripAnsi(out)
        .split('\n')
        .slice(1)
        .map((l) => l.length),
    );
    expect(widths.size).toBe(1);
  });
});
