import type { SandboxService, WorkspaceId } from '@soa/sandbox';

export type FileCheck = { file: string; result: 'found' | 'not_found' | 'file_missing' };

// Matches the sandbox's missing-file error ("File not found: x") but not "Workspace not found".
const FILE_MISSING = /file not found|ENOENT/i;

/** Trims each line, collapses whitespace runs to one space and drops empty lines. */
export function normalizeCode(s: string): string {
  return s
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Looks for `snippet` in each file, ignoring indentation and whitespace differences. */
export async function checkSnippet(
  sandbox: SandboxService,
  ws: WorkspaceId,
  files: string[],
  snippet: string,
): Promise<FileCheck[]> {
  const wanted = normalizeCode(snippet);
  const checks: FileCheck[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await sandbox.readFile(ws, file);
    } catch (err) {
      if (err instanceof Error && FILE_MISSING.test(err.message)) {
        checks.push({ file, result: 'file_missing' });
        continue;
      }
      throw err;
    }
    checks.push({ file, result: normalizeCode(content).includes(wanted) ? 'found' : 'not_found' });
  }
  return checks;
}
