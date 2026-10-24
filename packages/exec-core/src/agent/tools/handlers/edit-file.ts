import { ToolHandler, ToolContext, ToolResult } from '../../types.js';
import { WorkspaceGraphBuilder } from '../../../retrieval/graph/workspace-graph-builder.js';

function applyFuzzyOrExactReplace(
  original: string,
  oldStr: string,
  newStr: string,
  filePath: string,
): { updated: string; error?: string; alreadyApplied?: boolean } {
  let searchStr = oldStr;
  let targetContent = original;
  const isCrlf = original.includes('\r\n');

  let occurrences = targetContent.split(searchStr).length - 1;

  if (occurrences === 0 && isCrlf) {
    targetContent = targetContent.replace(/\r\n/g, '\n');
    searchStr = searchStr.replace(/\r\n/g, '\n');
    occurrences = targetContent.split(searchStr).length - 1;
  }

  if (occurrences === 1) {
    const replacementStr =
      isCrlf && !newStr.includes('\r\n') ? newStr.replace(/\n/g, '\r\n') : newStr;
    const updated = isCrlf
      ? original.replace(/\r\n/g, '\n').replace(searchStr, newStr).replace(/\n/g, '\r\n')
      : original.replace(searchStr, replacementStr);
    return { updated };
  }

  if (occurrences > 1) {
    return {
      updated: original,
      error: `Target string "old_str" found ${occurrences} times in ${filePath}. Provide a larger or more unique snippet to edit safely.`,
    };
  }

  // Fallback: Line-based normalized matching (whitespace and semicolon tolerance)
  const norm = (s: string) => s.trim().replace(/;$/, '').trim();
  const searchLines = searchStr.split(/\r?\n/).map(norm).filter((l) => l.length > 0);
  const contentLines = original.split(/\r?\n/);

  if (searchLines.length > 0) {
    let matchLineIdx = -1;
    let matchCount = 0;

    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      let allMatch = true;
      for (let j = 0; j < searchLines.length; j++) {
        const cLine = norm(contentLines[i + j] ?? '');
        const sLine = searchLines[j]!;
        if (cLine !== sLine && !cLine.endsWith(sLine)) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        matchLineIdx = i;
        matchCount++;
      }
    }

    if (matchCount === 1 && matchLineIdx !== -1) {
      const before = contentLines.slice(0, matchLineIdx);
      const after = contentLines.slice(matchLineIdx + searchLines.length);
      const repLines = newStr.split(/\r?\n/);
      const updatedLines = [...before, ...repLines, ...after];
      const eol = isCrlf ? '\r\n' : '\n';
      return { updated: updatedLines.join(eol) };
    }

    if (matchCount > 1) {
      return {
        updated: original,
        error: `Target string "old_str" matched ${matchCount} locations fuzzily in ${filePath}. Provide a more unique snippet.`,
      };
    }
  }

  // Check if newStr is ALREADY present in the file
  const trimmedNew = newStr.trim();
  if (trimmedNew.length > 5 && original.includes(trimmedNew)) {
    return {
      updated: original,
      alreadyApplied: true,
    };
  }

  const previewLines = original
    .split(/\r?\n/)
    .slice(0, 30)
    .map((l, idx) => `${idx + 1} | ${l}`)
    .join('\n');

  return {
    updated: original,
    error: `Target string "old_str" not found in ${filePath}. Ensure exact whitespace and content match.\n\nCurrent file content preview:\n${previewLines}`,
  };
}

export class EditFileHandler implements ToolHandler {
  readonly name = 'edit_file';
  readonly description =
    'Precisely replace an exact string occurrence with new content in a target file';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    // 1. Support batch edits if "edits" array is provided
    if (Array.isArray(args.edits) && args.edits.length > 0) {
      const editsByFile = new Map<string, Array<{ old_str: string; new_str: string }>>();
      for (const edit of args.edits as Record<string, unknown>[]) {
        const itemPath =
          (typeof edit.path === 'string' && edit.path.trim().length > 0 ? edit.path.trim() : null) ??
          (typeof args.path === 'string' && args.path.trim().length > 0 ? args.path.trim() : '');
        if (!itemPath) {
          return {
            status: 'error',
            output: '',
            error: 'Missing required argument "path" in edit items',
            latencyMs: 0,
          };
        }
        if (typeof edit.old_str !== 'string' || typeof edit.new_str !== 'string') {
          return {
            status: 'error',
            output: '',
            error: 'Each edit must include "old_str" and "new_str"',
            latencyMs: 0,
          };
        }
        if (!editsByFile.has(itemPath)) {
          editsByFile.set(itemPath, []);
        }
        editsByFile.get(itemPath)!.push({ old_str: edit.old_str, new_str: edit.new_str });
      }

      let totalApplied = 0;
      const updatedFiles: string[] = [];

      try {
        for (const [targetPath, edits] of editsByFile.entries()) {
          const original = await context.sandbox.readFile(context.workspaceId, targetPath);
          let currentContent = original;

          for (const { old_str, new_str } of edits) {
            const res = applyFuzzyOrExactReplace(currentContent, old_str, new_str, targetPath);
            if (res.error) {
              return {
                status: 'error',
                output: '',
                error: res.error,
                latencyMs: 0,
              };
            }
            currentContent = res.updated;
            totalApplied++;
          }

          const b64 = Buffer.from(currentContent, 'utf8').toString('base64');
          const writeCmd = `node -e 'const fs=require("fs"),path=require("path");const p=process.argv[1];fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.from(process.argv[2],"base64"));' "${targetPath}" "${b64}"`;
          const res = await context.sandbox.exec(context.workspaceId, writeCmd, { timeoutMs: 30000 });
          if (res.exitCode !== 0) {
            return {
              status: 'error',
              output: '',
              error: `Failed to persist batch edits to "${targetPath}": ${res.stderr}`,
              latencyMs: 0,
            };
          }

          if (context.graph) {
            try {
              const builder = new WorkspaceGraphBuilder();
              builder.updateFile(targetPath, currentContent, context.graph, context.workingDir);
            } catch {
              // ignore delta graph update
            }
          }
          updatedFiles.push(targetPath);
        }

        return {
          status: 'ok',
          output: `Successfully applied ${totalApplied} edits across ${updatedFiles.length} file(s): ${updatedFiles.join(', ')}`,
          error: null,
          latencyMs: 0,
          data: {
            files: updatedFiles,
            totalEdits: totalApplied,
          },
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          status: 'error',
          output: '',
          error: `Batch edit failed: ${message}`,
          latencyMs: 0,
        };
      }
    }

    // 2. Single edit
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
      const res = applyFuzzyOrExactReplace(original, oldStr, newStr, filePath);

      if (res.alreadyApplied) {
        return {
          status: 'ok',
          output: `Notice: "${filePath}" already contains the requested update. No further edit needed.`,
          error: null,
          latencyMs: 0,
        };
      }

      if (res.error) {
        return {
          status: 'error',
          output: '',
          error: res.error,
          latencyMs: 0,
        };
      }

      const updated = res.updated;
      const b64 = Buffer.from(updated, 'utf8').toString('base64');
      const writeCmd = `node -e 'const fs=require("fs"),path=require("path");const p=process.argv[1];fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.from(process.argv[2],"base64"));' "${filePath}" "${b64}"`;

      const execRes = await context.sandbox.exec(context.workspaceId, writeCmd, { timeoutMs: 30000 });

      if (execRes.exitCode !== 0) {
        const pyFallback = `python3 -c "import sys, base64, os; p=sys.argv[1]; os.makedirs(os.path.dirname(p) or '.', exist_ok=True); open(p, 'wb').write(base64.b64decode(sys.argv[2]))" "${filePath}" "${b64}"`;
        const pyRes = await context.sandbox.exec(context.workspaceId, pyFallback, {
          timeoutMs: 30000,
        });

        if (pyRes.exitCode !== 0) {
          return {
            status: 'error',
            output: '',
            error: `Failed to persist edit to "${filePath}": ${execRes.stderr || pyRes.stderr}`,
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
