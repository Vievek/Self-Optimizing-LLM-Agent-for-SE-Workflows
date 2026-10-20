import { RetrievalConfig, RetrievalSpanAttributesSchema } from '@soa/contracts';
import { CodeGraph } from './code-graph.js';
import { CodeNode, GraphRetrievalQuery, GraphRetrievalResult, RetrievedSnippet } from './types.js';

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  schema_version: '1.0',
  top_k: 5,
  min_score: 0.2,
  hybrid_weight_vector: 0.5,
  max_depth: 2,
};

export class GraphRetriever {
  private readonly graph: CodeGraph;
  private readonly config: RetrievalConfig;

  constructor(graph: CodeGraph, config: Partial<RetrievalConfig> = {}) {
    this.graph = graph;
    this.config = {
      ...DEFAULT_RETRIEVAL_CONFIG,
      ...config,
    };
  }

  /**
   * Retrieves relevant code context by traversing the AST-derived code graph.
   * Performs structural multi-hop search across CALLS, TESTS, IMPORTS, and INHERITS edges.
   */
  retrieve(queryInput: GraphRetrievalQuery | string): GraphRetrievalResult {
    const queryObj: GraphRetrievalQuery =
      typeof queryInput === 'string' ? { query: queryInput } : queryInput;

    const effectiveDepth = queryObj.maxDepth ?? this.config.max_depth;
    const maxResults = queryObj.maxResults ?? this.config.top_k;

    // 1. Identify starting anchor symbols from query
    const anchors = this.extractAnchorSymbols(queryObj);

    // 2. Multi-hop traversal starting from each anchor
    const snippetMap = new Map<string, RetrievedSnippet>();

    for (const anchor of anchors) {
      const paths = this.graph.traverseMultiHop(anchor, effectiveDepth);

      for (const p of paths) {
        const node = this.graph.getNode(p.nodeId);
        if (!node) continue;

        // Compute relevance based on distance from anchor and node kind
        const distancePenalty = Math.max(0.1, 1.0 - p.depth * 0.25);
        let kindBonus = 0.0;
        if (node.kind === 'function' || node.kind === 'test') kindBonus = 0.15;
        if (node.kind === 'class') kindBonus = 0.1;

        const relevanceScore = Math.min(
          1.0,
          Math.round((distancePenalty + kindBonus) * 1000) / 1000,
        );

        if (relevanceScore < this.config.min_score) {
          continue;
        }

        const existing = snippetMap.get(node.id);
        if (!existing || existing.relevanceScore < relevanceScore) {
          snippetMap.set(node.id, {
            node,
            depth: p.depth,
            path: p.path,
            relevanceScore,
            codeSnippet: this.formatSnippetHeader(node),
          });
        }
      }
    }

    // 3. Fallback: if no anchor yielded results, search all nodes by token match
    if (snippetMap.size === 0) {
      const fallbackNodes = this.searchNodesByFuzzyMatch(queryObj.query);
      for (const node of fallbackNodes) {
        snippetMap.set(node.id, {
          node,
          depth: 0,
          path: [node.name],
          relevanceScore: 0.5,
          codeSnippet: this.formatSnippetHeader(node),
        });
      }
    }

    // 4. Sort by relevance and truncate to maxResults
    const snippets = Array.from(snippetMap.values())
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxResults);

    const resultIds = snippets.map((s) => s.node.id);

    // 5. Generate schema-valid RetrievalSpanAttributes for OpenTelemetry
    const spanAttributes = RetrievalSpanAttributesSchema.parse({
      source: 'code',
      strategy: 'graph',
      decision_features: {
        anchors_used: anchors,
        depth: effectiveDepth,
        total_candidates: snippetMap.size,
      },
      query: queryObj.query,
      depth: effectiveDepth,
      result_ids: resultIds,
    });

    return {
      snippets,
      query: queryObj.query,
      depth: effectiveDepth,
      resultIds,
      spanAttributes,
    };
  }

  private extractAnchorSymbols(queryObj: GraphRetrievalQuery): string[] {
    const anchors = new Set<string>();

    if (queryObj.symbols) {
      for (const s of queryObj.symbols) {
        anchors.add(s);
      }
    }

    // Regex extract symbol tokens from query text (words with underscores or camelCase)
    const tokenRegex = /\b([a-zA-Z_][a-zA-Z0-9_]{2,})\b/g;
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(queryObj.query)) !== null) {
      const token = match[1]!;
      const matchingNodes = this.graph.findNodesByName(token);
      if (matchingNodes.length > 0) {
        anchors.add(token);
      }
    }

    // If query mentions a file path
    if (queryObj.filePath) {
      anchors.add(`module:${queryObj.filePath.replace(/\.py$/, '').replace(/[/\\]/g, '.')}`);
    }

    return Array.from(anchors);
  }

  private searchNodesByFuzzyMatch(queryText: string): CodeNode[] {
    const lowerQuery = queryText.toLowerCase();
    const matches: CodeNode[] = [];

    for (const node of this.graph.getAllNodes()) {
      if (lowerQuery.includes(node.name.toLowerCase())) {
        matches.push(node);
      }
    }

    return matches;
  }

  private formatSnippetHeader(node: CodeNode): string {
    const kindLabel = node.kind.toUpperCase();
    const doc = node.docstring ? `\n  """${node.docstring}"""` : '';
    return `# [${kindLabel}] ${node.name} (${node.filePath}:${node.startLine}-${node.endLine})${doc}`;
  }
}
