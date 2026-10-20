import {
  CodeNode,
  CodeEdge,
  FunctionNode,
  ClassNode,
  ModuleNode,
  TestNode,
  ImportStatement,
  LanguageAstParser,
  ParseResult,
} from './types.js';

const PYTHON_BUILTINS = new Set([
  'print',
  'len',
  'range',
  'isinstance',
  'str',
  'int',
  'float',
  'dict',
  'list',
  'set',
  'tuple',
  'super',
  'getattr',
  'setattr',
  'hasattr',
  'delattr',
  'bool',
  'min',
  'max',
  'sum',
  'any',
  'all',
  'zip',
  'enumerate',
  'iter',
  'next',
  'open',
  'id',
  'type',
  'repr',
  'callable',
  'sorted',
  'map',
  'filter',
  'format',
]);

export class PythonAstParser implements LanguageAstParser {
  supports(filePath: string): boolean {
    return filePath.endsWith('.py');
  }

  /**
   * Parses Python source text into typed CodeNodes (Module, Class, Function, Test)
   * and structural CodeEdges (CALLS, IMPORTS, INHERITS, TESTS, DEFINES).
   */
  parse(filePath: string, source: string): ParseResult {
    const nodes: CodeNode[] = [];
    const edges: CodeEdge[] = [];

    const lines = source.split('\n');
    const moduleName = filePath.replace(/\.py$/, '').replace(/[/\\]/g, '.');
    const moduleId = `module:${moduleName}`;

    // 1. Extract imports and create Module Node
    const imports = this.extractImports(lines);
    const moduleNode: ModuleNode = {
      id: moduleId,
      name: moduleName,
      filePath,
      startLine: 1,
      endLine: lines.length,
      kind: 'module',
      moduleName,
      imports,
    };
    nodes.push(moduleNode);

    // Create IMPORTS edges
    for (const imp of imports) {
      edges.push({
        sourceId: moduleId,
        targetId: `module:${imp.sourceModule}`,
        kind: 'IMPORTS',
        metadata: { symbols: imp.importedSymbols },
      });
    }

    // 2. Scan lines for classes and functions
    let currentClass: { name: string; id: string; indent: number } | null = null;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();
      const indent = line.search(/\S|$/);

      // Check if current class scope has ended
      if (currentClass && trimmed.length > 0 && indent <= currentClass.indent) {
        currentClass = null;
      }

      // Check for Class definition
      const classMatch = line.match(/^(\s*)class\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\(([^)]*)\))?:/);
      if (classMatch) {
        const classIndent = classMatch[1]?.length ?? 0;
        const className = classMatch[2]!;
        const baseClassesRaw = classMatch[3] ?? '';
        const baseClasses = baseClassesRaw
          .split(',')
          .map((b) => b.trim())
          .filter((b) => b.length > 0);

        const classStartLine = i + 1;
        const { endLine, docstring } = this.extractBlockDetails(lines, i);
        const classId = `class:${moduleName}.${className}`;

        const classNode: ClassNode = {
          id: classId,
          name: className,
          filePath,
          startLine: classStartLine,
          endLine,
          docstring,
          kind: 'class',
          baseClasses,
          methods: [],
        };
        nodes.push(classNode);

        // DEFINES edge from module to class
        edges.push({
          sourceId: moduleId,
          targetId: classId,
          kind: 'DEFINES',
        });

        // INHERITS edges
        for (const base of baseClasses) {
          edges.push({
            sourceId: classId,
            targetId: `class:${base}`,
            kind: 'INHERITS',
          });
        }

        currentClass = { name: className, id: classId, indent: classIndent };
        i++;
        continue;
      }

      // Check for Function / Method definition
      const funcMatch = line.match(/^(\s*)(async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)/);
      if (funcMatch) {
        const isAsync = Boolean(funcMatch[2]);
        const funcName = funcMatch[3]!;
        const params = (funcMatch[4] ?? '')
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        const funcStartLine = i + 1;
        const { endLine, bodyLines, docstring } = this.extractBlockDetails(lines, i);
        const isTest =
          funcName.startsWith('test_') ||
          (currentClass !== null && currentClass.name.startsWith('Test')) ||
          filePath.includes('test_') ||
          filePath.includes('tests/');

        const calls = this.extractCalls(bodyLines);

        if (isTest) {
          const testId = `test:${moduleName}.${funcName}`;
          const targetSymbols = this.inferTestTargets(funcName, calls);

          const testNode: TestNode = {
            id: testId,
            name: funcName,
            filePath,
            startLine: funcStartLine,
            endLine,
            docstring,
            kind: 'test',
            targetSymbols,
            calls,
          };
          nodes.push(testNode);

          edges.push({
            sourceId: currentClass ? currentClass.id : moduleId,
            targetId: testId,
            kind: 'DEFINES',
          });

          // Create TESTS edges
          for (const target of targetSymbols) {
            edges.push({
              sourceId: testId,
              targetId: `func:${target}`,
              kind: 'TESTS',
            });
          }

          // Create CALLS edges from test
          for (const call of calls) {
            edges.push({
              sourceId: testId,
              targetId: `func:${call}`,
              kind: 'CALLS',
            });
          }
        } else {
          const funcId = `func:${moduleName}.${funcName}`;
          const funcNode: FunctionNode = {
            id: funcId,
            name: funcName,
            filePath,
            startLine: funcStartLine,
            endLine,
            docstring,
            kind: 'function',
            isAsync,
            params,
            parentClass: currentClass ? currentClass.name : undefined,
            calls,
          };
          nodes.push(funcNode);

          edges.push({
            sourceId: currentClass ? currentClass.id : moduleId,
            targetId: funcId,
            kind: 'DEFINES',
          });

          if (currentClass) {
            const classNode = nodes.find((n) => n.id === currentClass!.id) as ClassNode;
            if (classNode) {
              classNode.methods.push(funcName);
            }
          }

          // Create CALLS edges
          for (const call of calls) {
            edges.push({
              sourceId: funcId,
              targetId: `func:${call}`,
              kind: 'CALLS',
            });
          }
        }

        i = endLine; // Jump to end of function block
        continue;
      }

      i++;
    }

    return { nodes, edges };
  }

  private extractImports(lines: string[]): ImportStatement[] {
    const imports: ImportStatement[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();

      // from foo.bar import baz, qux
      const fromMatch = line.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+(.+)$/);
      if (fromMatch) {
        const sourceModule = fromMatch[1]!;
        const rawSymbols = fromMatch[2]!;
        const isWildcard = rawSymbols.trim() === '*';
        const importedSymbols = isWildcard
          ? ['*']
          : rawSymbols.split(',').map((s) =>
              s
                .trim()
                .split(/\s+as\s+/)[0]!
                .trim(),
            );

        imports.push({
          sourceModule,
          importedSymbols,
          isWildcard,
          lineNumber: i + 1,
        });
        continue;
      }

      // import foo.bar as fb
      const importMatch = line.match(/^import\s+([a-zA-Z0-9_.]+)(?:\s+as\s+([a-zA-Z0-9_]+))?$/);
      if (importMatch) {
        const sourceModule = importMatch[1]!;
        const alias = importMatch[2];
        imports.push({
          sourceModule,
          importedSymbols: [alias ?? sourceModule],
          isWildcard: false,
          alias,
          lineNumber: i + 1,
        });
      }
    }

    return imports;
  }

  private extractBlockDetails(
    lines: string[],
    startIndex: number,
  ): { endLine: number; bodyLines: string[]; docstring?: string } {
    const parentLine = lines[startIndex] ?? '';
    const parentIndent = parentLine.search(/\S|$/);

    let docstring: string | undefined;
    const bodyLines: string[] = [];
    let endLine = startIndex + 1;
    let inDocstring = false;
    let docstringQuote = '';

    for (let j = startIndex + 1; j < lines.length; j++) {
      const line = lines[j] ?? '';
      const trimmed = line.trim();

      if (trimmed.length === 0) {
        endLine = j + 1;
        continue;
      }

      const indent = line.search(/\S|$/);
      if (indent <= parentIndent) {
        // Block ended
        break;
      }

      endLine = j + 1;
      bodyLines.push(line);

      // Check docstrings
      if (!docstring && (trimmed.startsWith('"""') || trimmed.startsWith("'''"))) {
        docstringQuote = trimmed.slice(0, 3);
        if (trimmed.length > 3 && trimmed.slice(3).includes(docstringQuote)) {
          // Single-line docstring
          docstring = trimmed.slice(3, trimmed.indexOf(docstringQuote, 3)).trim();
        } else {
          inDocstring = true;
          docstring = trimmed.slice(3) + '\n';
        }
      } else if (inDocstring) {
        if (trimmed.includes(docstringQuote)) {
          docstring = (docstring ?? '') + trimmed.slice(0, trimmed.indexOf(docstringQuote));
          docstring = docstring.trim();
          inDocstring = false;
        } else {
          docstring = (docstring ?? '') + line + '\n';
        }
      }
    }

    return { endLine, bodyLines, docstring };
  }

  private extractCalls(bodyLines: string[]): string[] {
    const calls = new Set<string>();
    const callRegex = /(?:self\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

    for (const line of bodyLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) continue;

      let match: RegExpExecArray | null;
      while ((match = callRegex.exec(line)) !== null) {
        const symbol = match[1]!;
        if (!PYTHON_BUILTINS.has(symbol) && symbol !== 'def' && symbol !== 'class') {
          calls.add(symbol);
        }
      }
    }

    return Array.from(calls);
  }

  private inferTestTargets(funcName: string, calls: string[]): string[] {
    const targets = new Set<string>();

    // e.g. test_validate_slug -> validate_slug
    if (funcName.startsWith('test_')) {
      const stripped = funcName.replace(/^test_/, '');
      targets.add(stripped);
      const parts = stripped.split('_');
      if (parts.length > 1) {
        // e.g. test_slug_words -> slug_words
        targets.add(parts.slice(-2).join('_'));
      }
    }

    // Direct calls in the test body are also target candidates
    for (const call of calls) {
      if (!call.startsWith('assert') && call.length > 2) {
        targets.add(call);
      }
    }

    return Array.from(targets);
  }
}
