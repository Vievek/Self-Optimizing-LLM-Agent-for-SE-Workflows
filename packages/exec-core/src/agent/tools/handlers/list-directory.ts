import { ToolHandler, ToolContext, ToolResult } from '../../types.js';

export class ListDirectoryHandler implements ToolHandler {
  readonly name = 'list_directory';
  readonly description = 'List files and directories in the workspace';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const dirPath = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : '.';
    let depth = 4;
    if (typeof args.depth === 'number' && Number.isInteger(args.depth)) {
      depth = Math.max(1, Math.min(args.depth, 6));
    }

    try {
      // Find files and directories with depth up to 4 (default), excluding noisy directories and appending / to directories
      const cmd = `find "${dirPath}" -maxdepth ${depth} -not -path "*/.*" -not -path "*node_modules*" -not -path "*dist*" -not -path "*.next*" -not -path "*build*" -not -path "*coverage*" | while read -r line; do if [ -d "$line" ]; then echo "$line/"; else echo "$line"; fi; done | sort`;
      const res = await context.sandbox.exec(context.workspaceId, cmd, { timeoutMs: 15000 });

      if (res.exitCode !== 0) {
        // Fallback to ls -la
        const lsRes = await context.sandbox.exec(context.workspaceId, `ls -la "${dirPath}"`, {
          timeoutMs: 15000,
        });
        if (lsRes.exitCode !== 0) {
          return {
            status: 'error',
            output: '',
            error: `Failed to list directory "${dirPath}": ${lsRes.stderr || res.stderr}`,
            latencyMs: res.durationMs + lsRes.durationMs,
          };
        }
        return {
          status: 'ok',
          output: lsRes.stdout.trim(),
          error: null,
          latencyMs: lsRes.durationMs,
        };
      }

      const rawEntries = res.stdout.trim().split('\n').filter(Boolean);
      const entries = rawEntries
        .map((p) => (dirPath === '.' ? p.replace(/^\.\//, '') : p))
        .filter((p) => p && p !== '.' && p !== './' && p !== '/');

      return {
        status: 'ok',
        output: entries.join('\n') || `(Directory "${dirPath}" is empty)`,
        error: null,
        latencyMs: res.durationMs,
        data: {
          path: dirPath,
          depth,
          entryCount: entries.length,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        output: '',
        error: `Error listing directory "${dirPath}": ${message}`,
        latencyMs: 0,
      };
    }
  }
}
