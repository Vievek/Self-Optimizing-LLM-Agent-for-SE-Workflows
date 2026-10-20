import { z } from 'zod';
import { RetrievalSpanAttributesSchema } from '@soa/contracts';

export type NodeKind = 'module' | 'class' | 'function' | 'test';
export type EdgeKind = 'CALLS' | 'IMPORTS' | 'INHERITS' | 'TESTS' | 'DEFINES';

export interface ImportStatement {
  sourceModule: string;
  importedSymbols: string[];
  isWildcard: boolean;
  alias?: string;
  lineNumber: number;
}

export interface BaseCodeNode {
  id: string; // e.g. "module:django.core.validators", "func:validate_slug_words"
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  docstring?: string;
}

export interface FunctionNode extends BaseCodeNode {
  kind: 'function';
  isAsync: boolean;
  params: string[];
  parentClass?: string;
  calls: string[]; // List of function/method names called inside this function
}

export interface ClassNode extends BaseCodeNode {
  kind: 'class';
  baseClasses: string[];
  methods: string[]; // IDs or names of member methods
}

export interface ModuleNode extends BaseCodeNode {
  kind: 'module';
  moduleName: string;
  imports: ImportStatement[];
}

export interface TestNode extends BaseCodeNode {
  kind: 'test';
  targetSymbols: string[];
  calls: string[];
}

export type CodeNode = FunctionNode | ClassNode | ModuleNode | TestNode;

export interface CodeEdge {
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
  metadata?: Record<string, unknown>;
}

export interface ParseResult {
  nodes: CodeNode[];
  edges: CodeEdge[];
}

export interface LanguageAstParser {
  supports(filePath: string): boolean;
  parse(filePath: string, source: string): ParseResult;
}

export interface GraphRetrievalQuery {
  query: string;
  symbols?: string[];
  filePath?: string;
  maxDepth?: number;
  maxResults?: number;
}

export interface RetrievedSnippet {
  node: CodeNode;
  depth: number;
  path: string[]; // Traversal trail: e.g. ['test_slug_validation', 'CALLS', 'validate_slug_words']
  relevanceScore: number;
  codeSnippet?: string;
}

export interface GraphRetrievalResult {
  snippets: RetrievedSnippet[];
  query: string;
  depth: number;
  resultIds: string[];
  spanAttributes: z.infer<typeof RetrievalSpanAttributesSchema>;
}
