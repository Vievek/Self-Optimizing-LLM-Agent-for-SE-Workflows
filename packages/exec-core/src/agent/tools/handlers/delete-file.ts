import { ToolHandler, ToolContext, ToolResult } from '../../types.js';

export class DeleteFileHandler implements ToolHandler {
  readonly name = 'delete_file';
  readonly description =
    'Delete a single file or multiple files from the workspace (e.g. redundant, conflicting, or deprecated files). Supports single file ("path") or multiple files ("paths").';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const rawPaths = args.paths;
    const pathsList: string[] = Array.isArray(rawPaths)
      ? (rawPaths as unknown[]).filter(
          (p): p is string => typeof p === 'string' && p.trim().length > 0,
        )
      : [];

    const singlePath = typeof args.path === 'string' ? args.path.trim() : '';
    if (singlePath && !pathsList.includes(singlePath)) {
      pathsList.push(singlePath);
    }

    if (pathsList.length === 0) {
      return {
        status: 'error',
        output: '',
        error:
          'Missing required argument: provide "path" (string) or "paths" (string[]) to delete.',
        latencyMs: 0,
      };
    }

    const deleted: string[] = [];
    const errors: string[] = [];

    for (const targetPath of pathsList) {
      // Security check: disallow directory traversal escaping sandbox
      if (targetPath === '.' || targetPath === '/' || targetPath.includes('..')) {
        errors.push(
          `Invalid path "${targetPath}": cannot delete root or escape directory using ".."`,
        );
        continue;
      }

      try {
        const pB64 = Buffer.from(targetPath, 'utf8').toString('base64');
        const rmCmd = `node -e 'const fs=require("fs"),p=Buffer.from(process.argv[1],"base64").toString("utf8");if(fs.existsSync(p)){const s=fs.statSync(p);if(s.isDirectory()){fs.rmSync(p,{recursive:true,force:true});}else{fs.unlinkSync(p);}}' "${pB64}"`;

        const res = await context.sandbox.exec(context.workspaceId, rmCmd, { timeoutMs: 15000 });
        if (res.exitCode !== 0) {
          const pyFallback = `python3 -c "import sys, base64, os, shutil; p=base64.b64decode(sys.argv[1]).decode('utf-8'); (shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)) if os.path.exists(p) else None" "${pB64}"`;
          const pyRes = await context.sandbox.exec(context.workspaceId, pyFallback, {
            timeoutMs: 15000,
          });
          if (pyRes.exitCode !== 0) {
            errors.push(`Failed to delete "${targetPath}": ${res.stderr || pyRes.stderr}`);
            continue;
          }
        }

        deleted.push(targetPath);

        // Update AST CodeGraph incrementally if attached
        if (context.graph && typeof context.graph.removeFileNodes === 'function') {
          context.graph.removeFileNodes(targetPath);
        }
      } catch (err: unknown) {
        errors.push(`Failed to delete "${targetPath}": ${String(err)}`);
      }
    }

    if (deleted.length === 0 && errors.length > 0) {
      return {
        status: 'error',
        output: '',
        error: errors.join('\n'),
        latencyMs: 0,
      };
    }

    const reason = typeof args.reason === 'string' ? ` (Reason: ${args.reason})` : '';
    let outputMsg = `Successfully deleted ${deleted.length} file(s):\n${deleted.map((p) => ` - ${p}`).join('\n')}${reason}`;
    if (errors.length > 0) {
      outputMsg += `\nErrors:\n${errors.join('\n')}`;
    }

    return {
      status: 'ok',
      output: outputMsg,
      error: null,
      latencyMs: 0,
      data: {
        deleted,
        failed: errors,
      },
    };
  }
}
