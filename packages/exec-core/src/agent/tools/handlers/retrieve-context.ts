import { ToolHandler, ToolContext, ToolResult } from '../../types.js';
import { FunctionNode, ClassNode } from '../../../retrieval/graph/types.js';

export class RetrieveContextHandler implements ToolHandler {
  readonly name = 'retrieve_context';
  readonly description = 'Retrieve AST code graph symbols, callers, callees, and definitions';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const hops =
      typeof args.hops === 'number' && args.hops > 0 ? Math.min(Math.floor(args.hops), 3) : 2;
    const limit =
      typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 50) : 25;

    if (!query) {
      return {
        status: 'error',
        output: '',
        error: 'Missing required argument "query"',
        latencyMs: 0,
      };
    }

    try {
      if (!context.retriever) {
        return {
          status: 'ok',
          output: `AST Code Graph Retriever is not attached to current context. Use "grep_search" to find occurrences of "${query}".`,
          error: null,
          latencyMs: 0,
          data: { attached: false },
        };
      }

      const retrieval = context.retriever.retrieve({
        query,
        maxDepth: hops,
        maxResults: limit,
      });

      const lines: string[] = [
        `AST Graph Retrieval for "${query}" (depth: ${retrieval.depth}):`,
        `Matched Nodes: ${retrieval.snippets.length}`,
      ];

      for (const snippet of retrieval.snippets) {
        const node = snippet.node;
        let sig = '';
        if (node.kind === 'function') {
          const fn = node as FunctionNode;
          const paramStr = fn.params && fn.params.length > 0 ? fn.params.join(', ') : '';
          sig = `(${paramStr})`;
        } else if (node.kind === 'class') {
          const cls = node as ClassNode;
          if (cls.baseClasses && cls.baseClasses.length > 0) {
            sig = ` extends ${cls.baseClasses.join(', ')}`;
          }
        }

        lines.push(
          `- [${node.kind.toUpperCase()}] ${node.name}${sig} (${node.filePath}:${node.startLine}-${node.endLine}) [score: ${snippet.relevanceScore.toFixed(2)}]`,
        );
        if (node.docstring) {
          lines.push(`    Doc: ${node.docstring}`);
        }
        if (node.kind === 'function') {
          const fn = node as FunctionNode;
          if (fn.calls && fn.calls.length > 0) {
            const filteredCalls = fn.calls.filter(
              (c) => !['req', 'res', 'next', 'then', 'catch'].includes(c),
            );
            if (filteredCalls.length > 0) {
              lines.push(`    Calls: ${filteredCalls.slice(0, 6).join(', ')}`);
            }
          }
        }
        if (snippet.path.length > 1) {
          lines.push(`    Traversal: ${snippet.path.join(' -> ')}`);
        }
      }

      return {
        status: 'ok',
        output: lines.join('\n'),
        error: null,
        latencyMs: 0,
        data: retrieval,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        output: '',
        error: `Retrieval failed for "${query}": ${message}`,
        latencyMs: 0,
      };
    }
  }
}
