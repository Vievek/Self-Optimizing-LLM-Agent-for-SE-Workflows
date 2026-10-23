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

    // Query tokens for fine-grained relevance ranking
    const queryTokens = (queryObj.query.match(/\b([a-zA-Z_][a-zA-Z0-9_]{2,})\b/g) || []).map((t) =>
      t.toLowerCase(),
    );

    // 2. Multi-hop traversal starting from each anchor
    const snippetMap = new Map<string, RetrievedSnippet>();

    for (const anchor of anchors) {
      const paths = this.graph.traverseMultiHop(anchor, effectiveDepth);

      for (const p of paths) {
        const node = this.graph.getNode(p.nodeId);
        if (!node) continue;

        const nodeNameLower = node.name.toLowerCase();
        const baseName =
          (node.filePath || '')
            .split('/')
            .pop()
            ?.split('\\')
            .pop()
            ?.split('.')[0]
            ?.toLowerCase() || '';
        const lowerFile = (node.filePath || '').toLowerCase();

        let matchQuality = 0.5;

        // Exact symbol name match (e.g. "Project")
        if (queryTokens.some((t) => t === nodeNameLower)) {
          matchQuality = 1.0;
        }
        // File basename matches token (e.g. "Project.js" or "projectController.js")
        else if (queryTokens.some((t) => t === baseName)) {
          matchQuality = 0.9;
        }
        // Node name contains token (e.g. "ProjectDetail", "createProject")
        else if (queryTokens.some((t) => nodeNameLower.includes(t))) {
          matchQuality = 0.8;
        }
        // File path contains token
        else if (queryTokens.some((t) => lowerFile.includes(t))) {
          if (node.kind === 'class' || node.kind === 'module') {
            matchQuality = 0.7;
          } else if (node.name.startsWith('handle') || node.name.startsWith('on')) {
            matchQuality = 0.3;
          } else {
            matchQuality = 0.5;
          }
        }

        // Distance penalty for multi-hop
        const depthPenalty = p.depth * 0.15;

        // Kind bonus: Models/Schemas (+0.15), Controllers/Functions (+0.1), Modules (+0.05)
        let kindBonus = 0.0;
        if (node.kind === 'class') kindBonus = 0.15;
        else if (node.kind === 'function') kindBonus = 0.1;
        else if (node.kind === 'module') kindBonus = 0.05;

        const relevanceScore = Math.max(
          0.1,
          Math.min(1.0, Math.round((matchQuality - depthPenalty + kindBonus) * 100) / 100),
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
      const lowerToken = token.toLowerCase();

      // 1. Symbol name matching (exact)
      const matchingNodes = this.graph.findNodesByName(token);
      for (const node of matchingNodes) {
        anchors.add(node.id);
      }

      // 2. Nodes containing token in name (e.g. ProjectDetail, createProject, projectSchema)
      for (const node of this.graph.getAllNodes()) {
        const lowerName = node.name.toLowerCase();
        if (lowerName.includes(lowerToken)) {
          anchors.add(node.id);
        }
      }

      // 3. File / Module matching: if file basename or path matches, add module node and definitions
      for (const node of this.graph.getAllNodes()) {
        const lowerFile = (node.filePath || '').toLowerCase();
        if (lowerFile.includes(lowerToken)) {
          const baseName = (node.filePath || '')
            .split('/')
            .pop()
            ?.split('\\')
            .pop()
            ?.split('.')[0]
            ?.toLowerCase();
          if (
            node.kind === 'module' ||
            node.kind === 'class' ||
            baseName === lowerToken ||
            baseName?.includes(lowerToken)
          ) {
            anchors.add(node.id);
          }
        }
      }
    }

    // If query mentions a file path
    if (queryObj.filePath) {
      anchors.add(`module:${queryObj.filePath.replace(/\.py$/, '').replace(/[/\\]/g, '.')}`);
    }

    return Array.from(anchors);
  }

  private searchNodesByFuzzyMatch(queryText: string): CodeNode[] {
    const lowerQuery = queryText.toLowerCase().replace(/\.[a-z]+$/, '');
    const matches: CodeNode[] = [];

    for (const node of this.graph.getAllNodes()) {
      const lowerName = node.name.toLowerCase();
      const lowerFile = (node.filePath || '').toLowerCase();
      if (
        lowerQuery.includes(lowerName) ||
        lowerName.includes(lowerQuery) ||
        lowerFile.includes(lowerQuery) ||
        lowerQuery.includes(lowerFile)
      ) {
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
