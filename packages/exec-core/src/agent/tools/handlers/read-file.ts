import { ToolHandler, ToolContext, ToolResult } from '../../types.js';

export class ReadFileHandler implements ToolHandler {
  readonly name = 'read_file';
  readonly description = 'Read file contents from workspace with optional offset and limit';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = typeof args.path === 'string' ? args.path : '';
    if (!filePath) {
      return {
        status: 'error',
        output: '',
        error: 'Missing required argument "path"',
        latencyMs: 0,
      };
    }

    try {
      const content = await context.sandbox.readFile(context.workspaceId, filePath);
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

      return {
        status: 'ok',
        output: numbered,
        error: null,
        latencyMs: 0,
        data: {
          totalLines: lines.length,
          offset,
          limit,
          returnedLines: selectedLines.length,
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
}
