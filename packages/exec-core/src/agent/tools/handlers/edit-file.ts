import { ToolHandler, ToolContext, ToolResult } from '../../types.js';
import { WorkspaceGraphBuilder } from '../../../retrieval/graph/workspace-graph-builder.js';

export class EditFileHandler implements ToolHandler {
  readonly name = 'edit_file';
  readonly description =
    'Precisely replace an exact string occurrence with new content in a target file';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = typeof args.path === 'string' ? args.path : '';
    const oldStr = typeof args.old_str === 'string' ? args.old_str : null;
    const newStr = typeof args.new_str === 'string' ? args.new_str : null;

    if (!filePath) {
      return {
        status: 'error',
        output: '',
        error: 'Missing required argument "path"',
        latencyMs: 0,
      };
    }

    if (oldStr === null) {
      return {
        status: 'error',
        output: '',
        error: 'Missing required argument "old_str"',
        latencyMs: 0,
      };
    }

    if (newStr === null) {
      return {
        status: 'error',
        output: '',
        error: 'Missing required argument "new_str"',
        latencyMs: 0,
      };
    }

    try {
      const original = await context.sandbox.readFile(context.workspaceId, filePath);

      // Check occurrences with CRLF tolerance for cross-platform workspaces (WSL / Windows)
      let searchStr = oldStr;
      let targetContent = original;
      const isCrlf = original.includes('\r\n');

      let occurrences = targetContent.split(searchStr).length - 1;

      if (occurrences === 0 && isCrlf) {
        targetContent = targetContent.replace(/\r\n/g, '\n');
        searchStr = searchStr.replace(/\r\n/g, '\n');
        occurrences = targetContent.split(searchStr).length - 1;
      }

      if (occurrences === 0) {
        return {
          status: 'error',
          output: '',
          error: `Target string "old_str" not found in ${filePath}. Ensure exact whitespace and content match.`,
          latencyMs: 0,
        };
      }

      if (occurrences > 1) {
        return {
          status: 'error',
          output: '',
          error: `Target string "old_str" found ${occurrences} times in ${filePath}. Provide a larger or more unique snippet to edit safely.`,
          latencyMs: 0,
        };
      }

      const replacementStr = isCrlf && !newStr.includes('\r\n') ? newStr.replace(/\n/g, '\r\n') : newStr;
      const updated = isCrlf
        ? original.replace(/\r\n/g, '\n').replace(searchStr, newStr).replace(/\n/g, '\r\n')
        : original.replace(searchStr, replacementStr);

      const b64 = Buffer.from(updated, 'utf8').toString('base64');
      const writeCmd = `node -e 'const fs=require("fs"),path=require("path");const p=process.argv[1];fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.from(process.argv[2],"base64"));' "${filePath}" "${b64}"`;

      const res = await context.sandbox.exec(context.workspaceId, writeCmd, { timeoutMs: 30000 });

      if (res.exitCode !== 0) {
        const pyFallback = `python3 -c "import sys, base64, os; p=sys.argv[1]; os.makedirs(os.path.dirname(p) or '.', exist_ok=True); open(p, 'wb').write(base64.b64decode(sys.argv[2]))" "${filePath}" "${b64}"`;
        const pyRes = await context.sandbox.exec(context.workspaceId, pyFallback, {
          timeoutMs: 30000,
        });

        if (pyRes.exitCode !== 0) {
          return {
            status: 'error',
            output: '',
            error: `Failed to persist edit to "${filePath}": ${res.stderr || pyRes.stderr}`,
            latencyMs: 0,
          };
        }
      }

      if (context.graph) {
        try {
          const builder = new WorkspaceGraphBuilder();
          builder.updateFile(filePath, updated, context.graph, context.workingDir);
        } catch {
          // ignore delta graph update errors
        }
      }

      return {
        status: 'ok',
        output: `Successfully updated ${filePath} (replaced 1 occurrence)`,
        error: null,
        latencyMs: 0,
        data: {
          path: filePath,
          occurrencesReplaced: 1,
          originalLength: original.length,
          newLength: updated.length,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        output: '',
        error: `Edit failed for "${filePath}": ${message}`,
        latencyMs: 0,
      };
    }
  }
}
