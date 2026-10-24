import { ToolHandler, ToolContext, ToolResult } from '../../types.js';
import { WorkspaceGraphBuilder } from '../../../retrieval/graph/workspace-graph-builder.js';

export class WriteFileHandler implements ToolHandler {
  readonly name = 'write_file';
  readonly description =
    'Write complete content to one or multiple files in workspace. Supports single file ("path" and "content") or batch writing ("files: Array<{ path, content }>").';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    if (args.error) {
      return {
        status: 'error',
        output: '',
        error: String(args.error),
        latencyMs: 0,
      };
    }

    // 1. Batch file write support
    const rawFiles = args.files;
    const filesList: Array<{ path: string; content: string }> = Array.isArray(rawFiles)
      ? (rawFiles as Array<Record<string, unknown>>)
          .filter((f) => f && typeof f.path === 'string')
          .map((f) => ({
            path: String(f.path).trim(),
            content:
              typeof f.content === 'string'
                ? f.content
                : typeof f.content === 'object' && f.content !== null
                  ? JSON.stringify(f.content, null, 2)
                  : '',
          }))
      : [];

    if (filesList.length > 0) {
      const written: string[] = [];
      const errors: string[] = [];

      for (const item of filesList) {
        try {
          // Encode both path and content in base64 to avoid shell escaping issues
          const pB64 = Buffer.from(item.path, 'utf8').toString('base64');
          const b64 = Buffer.from(item.content, 'utf8').toString('base64');
          const writeCmd = `node -e 'const fs=require("fs"),path=require("path");const p=Buffer.from(process.argv[1],"base64").toString("utf8");fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.from(process.argv[2],"base64"));' "${pB64}" "${b64}"`;
          const res = await context.sandbox.exec(context.workspaceId, writeCmd, {
            timeoutMs: 30000,
          });

          if (res.exitCode !== 0) {
            const pyFallback = `python3 -c "import sys, base64, os; p=base64.b64decode(sys.argv[1]).decode('utf-8'); os.makedirs(os.path.dirname(p) or '.', exist_ok=True); open(p, 'wb').write(base64.b64decode(sys.argv[2]))" "${pB64}" "${b64}"`;
            const pyRes = await context.sandbox.exec(context.workspaceId, pyFallback, {
              timeoutMs: 30000,
            });
            if (pyRes.exitCode !== 0) {
              errors.push(`Failed to write "${item.path}": ${res.stderr || pyRes.stderr}`);
            } else {
              written.push(item.path);
            }
          } else {
            written.push(item.path);
          }
        } catch (err: unknown) {
          errors.push(`Failed to write "${item.path}": ${String(err)}`);
        }
      }

      if (errors.length > 0 && written.length === 0) {
        return {
          status: 'error',
          output: '',
          error: errors.join('\n'),
          latencyMs: 0,
        };
      }

      if (context.graph) {
        try {
          const builder = new WorkspaceGraphBuilder();
          for (const item of filesList) {
            builder.updateFile(item.path, item.content, context.graph, context.workingDir);
          }
        } catch {
          // ignore delta graph update errors
        }
      }

      let outputMsg = `Successfully wrote ${written.length} files:\n${written.map((p) => ` - ${p}`).join('\n')}${errors.length > 0 ? `\nErrors:\n${errors.join('\n')}` : ''}`;
      if (args.truncated) {
        outputMsg += `\n⚠️ Note: The batch write was truncated due to output token limits. Only the complete files listed above were written. Please proceed with writing the remaining files in the next turn.`;
      }

      return {
        status: 'ok',
        output: outputMsg,
        error: null,
        latencyMs: 0,
        data: {
          filesWritten: written.length,
          filesFailed: errors.length,
          truncated: Boolean(args.truncated),
        },
      };
    }

    // 2. Single file write (standard execution)
    const filePath = typeof args.path === 'string' ? args.path : '';
    const content =
      typeof args.content === 'string'
        ? args.content
        : typeof args.content === 'object' && args.content !== null
          ? JSON.stringify(args.content, null, 2)
          : null;

    if (!filePath || filePath.trim().startsWith('{') || filePath.includes('\n')) {
      return {
        status: 'error',
        output: '',
        error: filePath
          ? `Invalid file path: "${filePath.substring(0, 60)}..." (path cannot contain newlines or JSON)`
          : 'Missing required argument "path"',
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
      // Encode both path and content in base64 to avoid shell escaping issues
      const pB64 = Buffer.from(filePath, 'utf8').toString('base64');
      const b64 = Buffer.from(content, 'utf8').toString('base64');
      const writeCmd = `node -e 'const fs=require("fs"),path=require("path");const p=Buffer.from(process.argv[1],"base64").toString("utf8");fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.from(process.argv[2],"base64"));' "${pB64}" "${b64}"`;

      const res = await context.sandbox.exec(context.workspaceId, writeCmd, { timeoutMs: 30000 });

      if (res.exitCode !== 0) {
        // Fallback for environments where node is not in path inside the sandbox container
        const pyFallback = `python3 -c "import sys, base64, os; p=base64.b64decode(sys.argv[1]).decode('utf-8'); os.makedirs(os.path.dirname(p) or '.', exist_ok=True); open(p, 'wb').write(base64.b64decode(sys.argv[2]))" "${pB64}" "${b64}"`;
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

      if (context.graph) {
        try {
          const builder = new WorkspaceGraphBuilder();
          builder.updateFile(filePath, content, context.graph, context.workingDir);
        } catch {
          // ignore delta graph update errors
        }
      }

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
