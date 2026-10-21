import { ToolHandler, ToolContext, ToolResult } from '../../types.js';

export class WriteFileHandler implements ToolHandler {
  readonly name = 'write_file';
  readonly description = 'Write complete content to a file in the workspace';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = typeof args.path === 'string' ? args.path : '';
    const content = typeof args.content === 'string' ? args.content : null;

    if (!filePath) {
      return {
        status: 'error',
        output: '',
        error: 'Missing required argument "path"',
        latencyMs: 0,
      };
    }

    if (content === null) {
      return {
        status: 'error',
        output: '',
        error: 'Missing required argument "content"',
        latencyMs: 0,
      };
    }

    try {
      const b64 = Buffer.from(content, 'utf8').toString('base64');
      // Execute file write safely inside sandbox workspace using node script or python fallback
      const writeCmd = `node -e 'const fs=require("fs"),path=require("path");const p=process.argv[1];fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.from(process.argv[2],"base64"));' "${filePath}" "${b64}"`;

      const res = await context.sandbox.exec(context.workspaceId, writeCmd, { timeoutMs: 30000 });

      if (res.exitCode !== 0) {
        // Fallback for environments where node is not in path inside the sandbox container
        const pyFallback = `python3 -c "import sys, base64, os; p=sys.argv[1]; os.makedirs(os.path.dirname(p) or '.', exist_ok=True); open(p, 'wb').write(base64.b64decode(sys.argv[2]))" "${filePath}" "${b64}"`;
        const pyRes = await context.sandbox.exec(context.workspaceId, pyFallback, {
          timeoutMs: 30000,
        });

        if (pyRes.exitCode !== 0) {
          return {
            status: 'error',
            output: '',
            error: `Failed to write file "${filePath}": ${res.stderr || pyRes.stderr}`,
            latencyMs: 0,
          };
        }
      }

      const byteCount = Buffer.byteLength(content, 'utf8');
      const lineCount = content.split('\n').length;

      return {
        status: 'ok',
        output: `Successfully wrote ${byteCount} bytes (${lineCount} lines) to ${filePath}`,
        error: null,
        latencyMs: 0,
        data: {
          path: filePath,
          bytesWritten: byteCount,
          lines: lineCount,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        output: '',
        error: `Write operation failed for "${filePath}": ${message}`,
        latencyMs: 0,
      };
    }
  }
}
