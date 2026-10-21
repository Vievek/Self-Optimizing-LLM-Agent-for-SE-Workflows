import { ToolHandler, ToolContext, ToolResult } from '../../types.js';

export class GrepSearchHandler implements ToolHandler {
  readonly name = 'grep_search';
  readonly description = 'Search for regex or text patterns across workspace files';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const pattern = typeof args.pattern === 'string' ? args.pattern : '';
    const searchPath = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : '.';

    if (!pattern) {
      return {
        status: 'error',
        output: '',
        error: 'Missing required argument "pattern"',
        latencyMs: 0,
      };
    }

    try {
      // Escape single quotes in pattern safely for bash
      const safePattern = pattern.replace(/'/g, "'\\''");
      const cmd = `grep -rn -I --exclude-dir=".git" --exclude-dir="node_modules" --exclude-dir="dist" -e '${safePattern}' "${searchPath}" | head -n 100`;

      const res = await context.sandbox.exec(context.workspaceId, cmd, { timeoutMs: 30000 });

      // grep exits with 1 if no lines were selected, which is not an error condition
      if (res.exitCode !== 0 && res.exitCode !== 1) {
        return {
          status: 'error',
          output: '',
          error: `Grep command failed with code ${res.exitCode}: ${res.stderr}`,
          latencyMs: res.durationMs,
        };
      }

      const matches = res.stdout.trim();
      const matchCount = matches ? matches.split('\n').length : 0;

      return {
        status: 'ok',
        output: matches || `No matches found for pattern "${pattern}" in "${searchPath}".`,
        error: null,
        latencyMs: res.durationMs,
        data: {
          pattern,
          searchPath,
          matchCount,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        output: '',
        error: `Grep search threw an unexpected error: ${message}`,
        latencyMs: 0,
      };
    }
  }
}
