import { ToolHandler, ToolContext, ToolResult } from '../../types.js';

export class ReadFileHandler implements ToolHandler {
  readonly name = 'read_file';
  readonly description =
    'Read file contents from workspace with optional offset and limit. Supports single "path" or batch "paths" array.';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const rawPaths: unknown = args.paths ?? args.path;
    const paths: string[] = Array.isArray(rawPaths)
      ? rawPaths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : typeof rawPaths === 'string' && rawPaths.trim().length > 0
        ? [rawPaths.trim()]
        : [];

    if (paths.length === 0) {
      return {
        status: 'error',
        output: '',
        error: 'Missing required argument "path" or "paths"',
        latencyMs: 0,
      };
    }

    // Helper to resolve candidates if the exact path is not found directly
    const resolveAndReadFile = async (
      targetPath: string,
    ): Promise<{ content: string; resolvedPath: string; wasRedirected: boolean }> => {
      try {
        const content = await context.sandbox.readFile(context.workspaceId, targetPath);
        return { content, resolvedPath: targetPath, wasRedirected: false };
      } catch (directErr) {
        // If a .env file was requested but not found, check .env.example or .env.local
        if (targetPath.endsWith('.env')) {
          const envFallbacks = [
            `${targetPath}.example`,
            `${targetPath}.local`,
            `${targetPath}.defaults`,
            `${targetPath}.sample`,
          ];
          for (const cand of envFallbacks) {
            try {
              const content = await context.sandbox.readFile(context.workspaceId, cand);
              return { content, resolvedPath: cand, wasRedirected: true };
            } catch {
              // try next
            }
          }
        }

        // Try common directory prefixes if path does not start with them
        const cleaned = targetPath.replace(/^\/+/, '');
        const prefixes = ['server/', 'src/', 'client/', 'lib/'];
        for (const prefix of prefixes) {
          if (!cleaned.startsWith(prefix)) {
            const candidate = `${prefix}${cleaned}`;
            try {
              const content = await context.sandbox.readFile(context.workspaceId, candidate);
              return { content, resolvedPath: candidate, wasRedirected: true };
            } catch {
              // try next
            }
          }
        }

        // Try locating file by unique basename in workspace
        const base = cleaned.split('/').pop();
        if (base && context.sandbox.exec) {
          try {
            const findCmd = `find . -maxdepth 5 -name "${base}" -not -path "*/.*" -not -path "*node_modules*" -not -path "*dist*" | head -n 1`;
            const findRes = await context.sandbox.exec(context.workspaceId, findCmd, {
              timeoutMs: 3000,
            });
            if (findRes.exitCode === 0 && findRes.stdout.trim()) {
              const foundPath = findRes.stdout.trim().replace(/^\.\//, '');
              const content = await context.sandbox.readFile(context.workspaceId, foundPath);
              return { content, resolvedPath: foundPath, wasRedirected: true };
            }
          } catch {
            // ignore find errors
          }
        }

        throw directErr;
      }
    };

    // Single file read (standard execution)
    if (paths.length === 1) {
      const filePath = paths[0]!;
      try {
        const { content, resolvedPath, wasRedirected } = await resolveAndReadFile(filePath);
        const lines = content.split('\n');

        const offset =
          typeof args.offset === 'number' && args.offset > 0 ? Math.floor(args.offset) : 1;
        const limit =
          typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : lines.length;

        const startIndex = offset - 1;
        const selectedLines = lines.slice(startIndex, startIndex + limit);

        const numbered = selectedLines
          .map((line: string, idx: number) => `${startIndex + idx + 1} | ${line}`)
          .join('\n');

        const redirectNotice = wasRedirected
          ? `[Notice: "${filePath}" was not found directly at root; automatically resolved and read from "${resolvedPath}"]\n`
          : '';

        return {
          status: 'ok',
          output: `${redirectNotice}${numbered}`,
          error: null,
          latencyMs: 0,
          data: {
            totalLines: lines.length,
            offset,
            limit,
            returnedLines: selectedLines.length,
            resolvedPath,
          },
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          status: 'error',
          output: '',
          error: `Failed to read file "${filePath}": ${message}`,
          latencyMs: 0,
        };
      }
    }

    // Batch file read execution
    const results: string[] = [];
    let hasError = false;
    const MAX_BATCH_LINES_PER_FILE = 60;

    for (const filePath of paths) {
      try {
        const { content, resolvedPath, wasRedirected } = await resolveAndReadFile(filePath);
        const lines = content.split('\n');
        const isTruncated = lines.length > MAX_BATCH_LINES_PER_FILE;
        const selected = isTruncated ? lines.slice(0, MAX_BATCH_LINES_PER_FILE) : lines;
        const numbered = selected.map((line, idx) => `${idx + 1} | ${line}`).join('\n');
        const truncationNotice = isTruncated
          ? `\n... [${lines.length - MAX_BATCH_LINES_PER_FILE} lines omitted in batch mode. Use single read_file with offset/limit to read specific section] ...`
          : '';
        const redirectNotice = wasRedirected ? ` [resolved to: ${resolvedPath}]` : '';
        results.push(
          `=== File: ${filePath}${redirectNotice} (${lines.length} lines) ===\n${numbered}${truncationNotice}`,
        );
      } catch (err: unknown) {
        hasError = true;
        const message = err instanceof Error ? err.message : String(err);
        results.push(`=== File: ${filePath} ===\n[Error: Failed to read file - ${message}]`);
      }
    }

    return {
      status: hasError && results.every((r) => r.includes('[Error:')) ? 'error' : 'ok',
      output: results.join('\n\n'),
      error: null,
      latencyMs: 0,
      data: {
        filesRequested: paths.length,
        filesRead: paths.length,
      },
    };
  }
}
