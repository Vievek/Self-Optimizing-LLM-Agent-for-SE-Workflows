import { CodeNode, CodeEdge, TestNode } from './types.js';

export interface GraphTraversalPath {
  nodeId: string;
  depth: number;
  path: string[];
}

export class CodeGraph {
  private readonly nodes = new Map<string, CodeNode>();
  private readonly nameToIds = new Map<string, Set<string>>();
  private readonly outgoing = new Map<string, CodeEdge[]>();
  private readonly incoming = new Map<string, CodeEdge[]>();

  addNode(node: CodeNode): void {
    this.nodes.set(node.id, node);

    if (!this.nameToIds.has(node.name)) {
      this.nameToIds.set(node.name, new Set());
    }
    this.nameToIds.get(node.name)!.add(node.id);
  }

  addEdge(edge: CodeEdge): void {
    if (!this.outgoing.has(edge.sourceId)) {
      this.outgoing.set(edge.sourceId, []);
    }
    this.outgoing.get(edge.sourceId)!.push(edge);

    if (!this.incoming.has(edge.targetId)) {
      this.incoming.set(edge.targetId, []);
    }
    this.incoming.get(edge.targetId)!.push(edge);
  }

  getNode(id: string): CodeNode | undefined {
    return this.nodes.get(id);
  }

  findNodesByName(name: string): CodeNode[] {
    const ids = this.nameToIds.get(name);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.nodes.get(id)!)
      .filter(Boolean);
  }

  /**
   * Returns all functions or tests that call the target symbol or node.
   */
  getCallers(symbolOrId: string): CodeNode[] {
    const targetIds = this.resolveSymbolToIds(symbolOrId);
    const callers = new Map<string, CodeNode>();

    for (const targetId of targetIds) {
      const inc = this.incoming.get(targetId) ?? [];
      for (const edge of inc) {
        if (edge.kind === 'CALLS') {
          const callerNode = this.nodes.get(edge.sourceId);
          if (callerNode) {
            callers.set(callerNode.id, callerNode);
          }
        }
      }
    }

    return Array.from(callers.values());
  }

  /**
   * Returns all symbols/functions called by the source node.
   */
  getCallees(symbolOrId: string): CodeNode[] {
    const sourceIds = this.resolveSymbolToIds(symbolOrId);
    const callees = new Map<string, CodeNode>();

    for (const sourceId of sourceIds) {
      const out = this.outgoing.get(sourceId) ?? [];
      for (const edge of out) {
        if (edge.kind === 'CALLS') {
          const calleeNode = this.resolveTargetNode(edge.targetId);
          if (calleeNode) {
            callees.set(calleeNode.id, calleeNode);
          }
        }
      }
    }

    return Array.from(callees.values());
  }

  /**
   * Returns test nodes that test or call the target symbol.
   */
  getTestsFor(symbolOrId: string): TestNode[] {
    const targetIds = this.resolveSymbolToIds(symbolOrId);
    const testNodes = new Map<string, TestNode>();

    for (const targetId of targetIds) {
      const inc = this.incoming.get(targetId) ?? [];
      for (const edge of inc) {
        if (edge.kind === 'TESTS' || edge.kind === 'CALLS') {
          const node = this.nodes.get(edge.sourceId);
          if (node && node.kind === 'test') {
            testNodes.set(node.id, node);
          }
        }
      }
    }

    return Array.from(testNodes.values());
  }

  /**
   * Multi-hop breadth-first traversal from a starting symbol or ID up to maxDepth.
   * Explores CALLS, TESTS, INHERITS, and IMPORTS edges in both forward and reverse directions.
   */
  traverseMultiHop(startSymbolOrId: string, maxDepth: number = 2): GraphTraversalPath[] {
    const startIds = this.resolveSymbolToIds(startSymbolOrId);
    if (startIds.length === 0) return [];

    const visited = new Set<string>();
    const results: GraphTraversalPath[] = [];
    const queue: Array<{ id: string; depth: number; path: string[] }> = [];

    for (const id of startIds) {
      visited.add(id);
      queue.push({ id, depth: 0, path: [this.getNodeName(id)] });
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      results.push({
        nodeId: current.id,
        depth: current.depth,
        path: current.path,
      });

      if (current.depth >= maxDepth) {
        continue;
      }

      // Explore outgoing edges
      const outEdges = this.outgoing.get(current.id) ?? [];
      for (const edge of outEdges) {
        const nextId = this.resolveCanonicalId(edge.targetId);
        if (nextId && !visited.has(nextId)) {
          visited.add(nextId);
          queue.push({
            id: nextId,
            depth: current.depth + 1,
            path: [...current.path, `->[${edge.kind}]->`, this.getNodeName(nextId)],
          });
        }
      }

      // Explore incoming edges (e.g. reverse CALLS to find callers, reverse TESTS to find tests)
      const targetIds = this.resolveSymbolToIds(this.getNodeName(current.id));
      targetIds.push(current.id);
      for (const tId of targetIds) {
        const inEdges = this.incoming.get(tId) ?? [];
        for (const edge of inEdges) {
          const prevId = edge.sourceId;
          if (!visited.has(prevId)) {
            visited.add(prevId);
            queue.push({
              id: prevId,
              depth: current.depth + 1,
              path: [...current.path, `<-[${edge.kind}]<-`, this.getNodeName(prevId)],
            });
          }
        }
      }
    }

    return results;
  }

  getAllNodes(): CodeNode[] {
    return Array.from(this.nodes.values());
  }

  getStats(): {
    totalNodes: number;
    modules: number;
    classes: number;
    functions: number;
    tests: number;
    totalEdges: number;
  } {
    let modules = 0;
    let classes = 0;
    let functions = 0;
    let tests = 0;
    let totalEdges = 0;

    for (const node of this.nodes.values()) {
      if (node.kind === 'module') modules++;
      else if (node.kind === 'class') classes++;
      else if (node.kind === 'function') functions++;
      else if (node.kind === 'test') tests++;
    }

    for (const edges of this.outgoing.values()) {
      totalEdges += edges.length;
    }

    return {
      totalNodes: this.nodes.size,
      modules,
      classes,
      functions,
      tests,
      totalEdges,
    };
  }

  private resolveSymbolToIds(symbolOrId: string): string[] {
    const ids = new Set<string>();

    if (this.nodes.has(symbolOrId)) {
      ids.add(symbolOrId);
    }

    // Check by exact name
    const byName = this.nameToIds.get(symbolOrId);
    if (byName) {
      for (const id of byName) ids.add(id);
    }

    // Add shorthand variations that might be edge targets
    ids.add(symbolOrId);
    ids.add(`func:${symbolOrId}`);
    ids.add(`class:${symbolOrId}`);

    // Check partial symbol name (e.g. "func:validate_slug")
    const lower = symbolOrId.toLowerCase();
    for (const [id, node] of this.nodes.entries()) {
      if (node.name.toLowerCase() === lower || id.toLowerCase().endsWith(`.${lower}`)) {
        ids.add(id);
      }
    }

    return Array.from(ids);
  }

  private resolveTargetNode(targetId: string): CodeNode | undefined {
    if (this.nodes.has(targetId)) {
      return this.nodes.get(targetId);
    }
    // Handle func:foo
    if (targetId.startsWith('func:')) {
      const symbol = targetId.slice(5);
      const candidates = this.findNodesByName(symbol);
      return candidates[0];
    }
    return undefined;
  }

  private resolveCanonicalId(targetId: string): string | undefined {
    if (this.nodes.has(targetId)) return targetId;
    const node = this.resolveTargetNode(targetId);
    return node ? node.id : undefined;
  }

  private getNodeName(id: string): string {
    const node = this.nodes.get(id);
    return node ? node.name : id.split(':').pop()!;
  }
}
