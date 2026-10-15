export interface ContractCheckResult {
  contract: string;
  version: string;
  valid: boolean;
  error?: string;
}

export function renderContractCheckPanel(results: ContractCheckResult[], minWidth = 72): string {
  const title = 'CONTRACT HEALTH CHECK PANEL';

  let maxRowLen = title.length + 4;
  for (const res of results) {
    const icon = res.valid ? '[PASS]' : '[FAIL]';
    const row = `${icon} ${res.contract} (v${res.version})`;
    const status = res.valid ? 'OK' : res.error ? `ERR: ${res.error}` : 'INVALID';
    maxRowLen = Math.max(maxRowLen, row.length + status.length + 4);
  }
  const width = Math.max(minWidth, maxRowLen);
  const border = '═'.repeat(width);

  const lines: string[] = [`╔${border}╗`, `║ ${title.padEnd(width - 2)} ║`, `╠${border}╣`];

  let totalValid = 0;
  for (const res of results) {
    if (res.valid) totalValid++;
    const icon = res.valid ? '[PASS]' : '[FAIL]';
    const row = `${icon} ${res.contract} (v${res.version})`;
    const status = res.valid ? 'OK' : res.error ? `ERR: ${res.error}` : 'INVALID';
    const spaceCount = Math.max(1, width - 2 - row.length - status.length);
    const content = `${row}${' '.repeat(spaceCount)}${status}`;
    lines.push(`║ ${content.padEnd(width - 2)} ║`);
  }

  lines.push(`╠${border}╣`);
  const summary = `Status: ${totalValid}/${results.length} contracts valid`;
  lines.push(`║ ${summary.padEnd(width - 2)} ║`);
  lines.push(`╚${border}╝`);

  return lines.join('\n');
}
