export interface TableColumn {
  header: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
}

export function renderRecordTable(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][],
  title?: string,
): string {
  if (headers.length === 0) return '';

  const stringRows = rows.map((row) => headers.map((_, i) => String(row[i] ?? '')));

  const colWidths = headers.map((h, i) => {
    const maxRowLen = stringRows.reduce((max, row) => Math.max(max, (row[i] ?? '').length), 0);
    return Math.max(h.length, maxRowLen);
  });

  const padCell = (text: string, width: number, align: 'left' | 'right' | 'center' = 'left') => {
    if (text.length >= width) return text;
    const diff = width - text.length;
    if (align === 'right') return ' '.repeat(diff) + text;
    if (align === 'center') {
      const left = Math.floor(diff / 2);
      const right = diff - left;
      return ' '.repeat(left) + text + ' '.repeat(right);
    }
    return text + ' '.repeat(diff);
  };

  const lineSeparator = '+' + colWidths.map((w) => '-'.repeat(w + 2)).join('+') + '+';
  const headerLine = '| ' + headers.map((h, i) => padCell(h, colWidths[i]!)).join(' | ') + ' |';

  const output: string[] = [];
  if (title) {
    output.push(`=== ${title} ===`);
  }
  output.push(lineSeparator);
  output.push(headerLine);
  output.push(lineSeparator);

  if (stringRows.length === 0) {
    const emptyWidth = colWidths.reduce((sum, w) => sum + w + 3, 1) - 2;
    output.push('| ' + padCell('(no records)', emptyWidth, 'center') + ' |');
  } else {
    for (const row of stringRows) {
      const rowLine = '| ' + row.map((cell, i) => padCell(cell, colWidths[i]!)).join(' | ') + ' |';
      output.push(rowLine);
    }
  }

  output.push(lineSeparator);
  return output.join('\n');
}
