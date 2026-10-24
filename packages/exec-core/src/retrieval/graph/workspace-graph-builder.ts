import * as fs from 'fs';
import * as path from 'path';
import { CodeGraph, SerializedCodeGraph } from './code-graph.js';
import { GraphRetriever } from './graph-retriever.js';
import { MultiLanguageAstParser } from './multi-language-ast-parser.js';

export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.gemini',
  'coverage',
  '.cache',
  'agent-run.log',
  '.env',
  '.env.local',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '.soa_graph.json',
  '.soa_cache',
];

export interface BuildGraphResult {
  graph: CodeGraph;
  retriever: GraphRetriever;
  parsedFilesCount: number;
  fromCache: boolean;
  reindexedFilesCount: number;
}

export class WorkspaceGraphBuilder {
  private readonly parser: MultiLanguageAstParser;

  constructor(customParser?: MultiLanguageAstParser) {
    this.parser = customParser ?? new MultiLanguageAstParser();
  }

  /**
   * Scans a workspace directory and builds an AST-backed CodeGraph.
   * Leverages `.soa_graph.json` cache when available, performing fast mtime-based
   * incremental updates rather than rescanning all files every time.
   */
  async buildFromDirectory(
    workspaceDir: string,
    existingGraph?: CodeGraph,
    options?: { useCache?: boolean; cacheFileName?: string },
  ): Promise<BuildGraphResult> {
    const cacheFileName = options?.cacheFileName ?? '.soa_graph.json';
    const cachePath = path.join(workspaceDir, cacheFileName);
    const useCache = options?.useCache !== false;

    if (!fs.existsSync(workspaceDir)) {
      const graph = existingGraph ?? new CodeGraph();
      return {
        graph,
        retriever: new GraphRetriever(graph),
        parsedFilesCount: 0,
        fromCache: false,
        reindexedFilesCount: 0,
      };
    }

    // 1. Check for valid cached graph
    if (useCache && fs.existsSync(cachePath)) {
      try {
        const raw = await fs.promises.readFile(cachePath, 'utf8');
        const data = JSON.parse(raw) as SerializedCodeGraph;
        const graph = CodeGraph.fromJSON(data);
        const cachedMtimes = data.fileMtimes ?? {};

        const filePaths = this.collectFiles(workspaceDir);
        const currentMtimes: Record<string, number> = {};
        let reindexedFilesCount = 0;
        let dirty = false;

        const currentRelFiles = new Set<string>();

        for (const fullPath of filePaths) {
          const relPath = path.relative(workspaceDir, fullPath).replace(/\\/g, '/');
          if (!this.parser.supports(relPath)) continue;

          currentRelFiles.add(relPath);
          let stat: fs.Stats;
          try {
            stat = fs.statSync(fullPath);
          } catch {
            continue;
          }
          currentMtimes[relPath] = stat.mtimeMs;

          const cachedMtime = cachedMtimes[relPath];
          if (cachedMtime === undefined) {
            // New file added
            try {
              const source = await fs.promises.readFile(fullPath, 'utf8');
              const parseResult = this.parser.parse(relPath, source);
              for (const node of parseResult.nodes) graph.addNode(node);
              for (const edge of parseResult.edges) graph.addEdge(edge);
              reindexedFilesCount++;
              dirty = true;
            } catch {
              // Ignore parse errors on unparseable/partial new files
            }
          } else if (cachedMtime !== stat.mtimeMs) {
            // Modified file
            try {
              const source = await fs.promises.readFile(fullPath, 'utf8');
              this.updateFile(fullPath, source, graph, workspaceDir);
              reindexedFilesCount++;
              dirty = true;
            } catch {
              // Ignore parse errors on unparseable/partial modified files
            }
          }
        }

        // Check for deleted files
        for (const cachedFile of Object.keys(cachedMtimes)) {
          if (!currentRelFiles.has(cachedFile)) {
            graph.removeFileNodes(cachedFile);
            reindexedFilesCount++;
            dirty = true;
          }
        }

        if (dirty) {
          this.saveCache(workspaceDir, graph, currentMtimes, cacheFileName);
        }

        return {
          graph,
          retriever: new GraphRetriever(graph),
          parsedFilesCount: currentRelFiles.size,
          fromCache: true,
          reindexedFilesCount,
        };
      } catch {
        // Corrupted cache - fall through to full build
      }
    }

    // 2. Full scan and build
    const graph = existingGraph ?? new CodeGraph();
    let parsedFilesCount = 0;
    const fileMtimes: Record<string, number> = {};
    const filePaths = this.collectFiles(workspaceDir);

    for (const fullPath of filePaths) {
      const relPath = path.relative(workspaceDir, fullPath).replace(/\\/g, '/');

      if (!this.parser.supports(relPath)) {
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);
        fileMtimes[relPath] = stat.mtimeMs;
        const source = await fs.promises.readFile(fullPath, 'utf8');
        const parseResult = this.parser.parse(relPath, source);

        for (const node of parseResult.nodes) {
          graph.addNode(node);
        }
        for (const edge of parseResult.edges) {
          graph.addEdge(edge);
        }
        parsedFilesCount++;
      } catch (err: unknown) {
        // Parsing errors on invalid/partial source files should not crash the builder
      }
    }

    // Save cache to disk for instant loading on subsequent runs
    if (useCache) {
      this.saveCache(workspaceDir, graph, fileMtimes, cacheFileName);
    }

    return {
      graph,
      retriever: new GraphRetriever(graph),
      parsedFilesCount,
      fromCache: false,
      reindexedFilesCount: parsedFilesCount,
    };
  }

  /**
   * Persists the AST CodeGraph to disk cache (.soa_graph.json).
   */
  saveCache(
    workspaceDir: string,
    graph: CodeGraph,
    fileMtimes?: Record<string, number>,
    cacheFileName: string = '.soa_graph.json',
  ): void {
    try {
      const cachePath = path.join(workspaceDir, cacheFileName);
      const data = graph.toJSON(fileMtimes);
      fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // Non-blocking fallback
    }
  }

  /**
   * Incremental delta update: re-indexes only a single modified file and updates cache.
   */
  updateFile(filePath: string, source: string, graph: CodeGraph, workspaceDir?: string): boolean {
    const relPath = workspaceDir
      ? path.relative(workspaceDir, filePath).replace(/\\/g, '/')
      : filePath.replace(/\\/g, '/').replace(/^\.\//, '');

    // 1. Remove stale nodes/edges for this file
    graph.removeFileNodes(relPath);

    if (!this.parser.supports(relPath)) {
      return false;
    }

    // 2. Re-parse and insert fresh AST nodes
    try {
      const parseResult = this.parser.parse(relPath, source);
      for (const node of parseResult.nodes) {
        graph.addNode(node);
      }
      for (const edge of parseResult.edges) {
        graph.addEdge(edge);
      }

      // 3. Incrementally update disk cache if workspaceDir provided and cache exists
      if (workspaceDir) {
        const cachePath = path.join(workspaceDir, '.soa_graph.json');
        if (fs.existsSync(cachePath)) {
          this.saveCache(workspaceDir, graph);
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Incremental delta removal: scrubs a deleted file from the AST graph and updates cache.
   */
  removeFile(filePath: string, graph: CodeGraph, workspaceDir?: string): number {
    const relPath = workspaceDir
      ? path.relative(workspaceDir, filePath).replace(/\\/g, '/')
      : filePath.replace(/\\/g, '/').replace(/^\.\//, '');

    const removed = graph.removeFileNodes(relPath);

    if (workspaceDir) {
      const cachePath = path.join(workspaceDir, '.soa_graph.json');
      if (fs.existsSync(cachePath)) {
        this.saveCache(workspaceDir, graph);
      }
    }

    return removed;
  }

  private collectFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryName = entry.name;
      if (DEFAULT_IGNORE_PATTERNS.some((pat) => entryName === pat || entryName.startsWith('.'))) {
        continue;
      }

      const fullPath = path.join(dir, entryName);
      if (entry.isDirectory()) {
        results.push(...this.collectFiles(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }

    return results;
  }
}
