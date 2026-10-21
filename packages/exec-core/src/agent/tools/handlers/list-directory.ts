import { ToolHandler, ToolContext, ToolResult } from '../../types.js';

export class ListDirectoryHandler implements ToolHandler {
  readonly name = 'list_directory';
  readonly description = 'List files and directories in the workspace';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const dirPath = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : '.';

    try {
      // Find files and directories with depth 2, excluding .git and node_modules
      const cmd = `find "${dirPath}" -maxdepth 2 -not -path "*/.*" -not -path "*node_modules*" | sort`;
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

      const entries = res.stdout.trim().split('\n').filter(Boolean);

      return {
        status: 'ok',
        output: entries.join('\n') || `(Directory "${dirPath}" is empty)`,
        error: null,
        latencyMs: res.durationMs,
        data: {
          path: dirPath,
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
