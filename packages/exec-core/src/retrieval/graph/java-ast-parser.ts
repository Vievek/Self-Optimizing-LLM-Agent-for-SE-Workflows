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

const JAVA_BUILTINS = new Set([
  'println',
  'print',
  'printf',
  'equals',
  'hashCode',
  'toString',
  'getClass',
  'notify',
  'notifyAll',
  'wait',
  'get',
  'set',
  'add',
  'remove',
  'size',
  'isEmpty',
  'contains',
  'length',
  'valueOf',
  'format',
  'of',
  'builder',
  'build',
]);

export class JavaAstParser implements LanguageAstParser {
  supports(filePath: string): boolean {
    return filePath.endsWith('.java');
  }

  parse(filePath: string, source: string): ParseResult {
    const nodes: CodeNode[] = [];
    const edges: CodeEdge[] = [];

    const lines = source.split('\n');

    // 1. Extract package and imports
    let packageName = '';
    const imports: ImportStatement[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();

      const pkgMatch = line.match(/^package\s+([a-zA-Z0-9_.]+);/);
      if (pkgMatch) {
        packageName = pkgMatch[1]!;
      }

      const importMatch = line.match(/^import(?:\s+static)?\s+([a-zA-Z0-9_.*]+);/);
      if (importMatch) {
        const fullImport = importMatch[1]!;
        const parts = fullImport.split('.');
        const lastPart = parts.pop()!;
        const sourceModule = parts.join('.');

        imports.push({
          sourceModule,
          importedSymbols: [lastPart],
          isWildcard: lastPart === '*',
          lineNumber: i + 1,
        });
      }
    }

    const simpleFileName = filePath.split(/[/\\]/).pop()!.replace('.java', '');
    const moduleName = packageName ? `${packageName}.${simpleFileName}` : simpleFileName;
    const moduleId = `module:${moduleName}`;

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

    for (const imp of imports) {
      edges.push({
        sourceId: moduleId,
        targetId: `module:${imp.sourceModule}`,
        kind: 'IMPORTS',
        metadata: { symbols: imp.importedSymbols },
      });
    }

    const isTestFile =
      simpleFileName.endsWith('Test') ||
      simpleFileName.endsWith('Tests') ||
      filePath.includes('/test/');

    let currentClass: { name: string; id: string; braceDepth: number } | null = null;
    let braceDepth = 0;
    let pendingAnnotations: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      if (trimmed.startsWith('@')) {
        pendingAnnotations.push(trimmed);
        continue;
      }

      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;

      // Class or Interface: public class Foo extends Bar implements Baz1, Baz2 {
      const classMatch = line.match(
        /(?:public|protected|private|abstract|static|final|\s)*\b(class|interface)\s+([a-zA-Z0-9_]+)(?:\s+extends\s+([a-zA-Z0-9_.]+))?(?:\s+implements\s+([^{]+))?/,
      );
      if (classMatch) {
        const className = classMatch[2]!;
        const baseClass = classMatch[3];
        const interfacesRaw = classMatch[4] ?? '';
        const baseClasses: string[] = [];
        if (baseClass) baseClasses.push(baseClass);
        if (interfacesRaw) {
          baseClasses.push(
            ...interfacesRaw
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          );
        }

        const classId = `class:${packageName ? `${packageName}.${className}` : className}`;
        const classNode: ClassNode = {
          id: classId,
          name: className,
          filePath,
          startLine: i + 1,
          endLine: Math.min(lines.length, i + 50),
          kind: 'class',
          baseClasses,
          methods: [],
        };
        nodes.push(classNode);

        edges.push({
          sourceId: moduleId,
          targetId: classId,
          kind: 'DEFINES',
        });

        for (const base of baseClasses) {
          edges.push({
            sourceId: classId,
            targetId: `class:${base}`,
            kind: 'INHERITS',
          });
        }

        currentClass = { name: className, id: classId, braceDepth: braceDepth + 1 };
        pendingAnnotations = [];
      }

      // Method definition: public ReturnType methodName(ArgType arg1, ArgType arg2) {
      const methodMatch = line.match(
        /(?:public|protected|private|static|final|synchronized|abstract|\s)*\b([a-zA-Z0-9_<>[\]]+)\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(?:throws\s+[^{;]+)?(?:\s*\{|;)/,
      );
      if (methodMatch && currentClass) {
        const returnType = methodMatch[1]!;
        const methodName = methodMatch[2]!;

        if (
          returnType !== 'new' &&
          methodName !== 'class' &&
          methodName !== 'if' &&
          methodName !== 'for' &&
          methodName !== 'while'
        ) {
          const params = (methodMatch[3] ?? '')
            .split(',')
            .map((p) => p.trim())
            .filter((p) => p.length > 0);

          const isTest =
            isTestFile ||
            pendingAnnotations.some((a) => a.includes('@Test')) ||
            methodName.startsWith('test');

          const block = this.extractBlock(lines, i);
          const calls = this.extractCalls(block.bodyLines);

          if (isTest) {
            const testId = `test:${packageName ? `${packageName}.${currentClass.name}` : currentClass.name}.${methodName}`;
            const targetSymbols = this.inferTestTargets(methodName, calls);

            const testNode: TestNode = {
              id: testId,
              name: methodName,
              filePath,
              startLine: i + 1,
              endLine: block.endLine,
              kind: 'test',
              targetSymbols,
              calls,
            };
            nodes.push(testNode);

            edges.push({
              sourceId: currentClass.id,
              targetId: testId,
              kind: 'DEFINES',
            });

            for (const target of targetSymbols) {
              edges.push({
                sourceId: testId,
                targetId: `func:${target}`,
                kind: 'TESTS',
              });
            }

            for (const call of calls) {
              edges.push({
                sourceId: testId,
                targetId: `func:${call}`,
                kind: 'CALLS',
              });
            }
          } else {
            const funcId = `func:${packageName ? `${packageName}.${currentClass.name}` : currentClass.name}.${methodName}`;
            const funcNode: FunctionNode = {
              id: funcId,
              name: methodName,
              filePath,
              startLine: i + 1,
              endLine: block.endLine,
              kind: 'function',
              isAsync: false,
              params,
              parentClass: currentClass.name,
              calls,
            };
            nodes.push(funcNode);

            edges.push({
              sourceId: currentClass.id,
              targetId: funcId,
              kind: 'DEFINES',
            });

            currentClass &&
              (nodes.find((n) => n.id === currentClass!.id) as ClassNode)?.methods.push(methodName);

            for (const call of calls) {
              edges.push({
                sourceId: funcId,
                targetId: `func:${call}`,
                kind: 'CALLS',
              });
            }
          }

          pendingAnnotations = [];
        }
      }

      braceDepth += openBraces - closeBraces;
      if (currentClass && braceDepth < currentClass.braceDepth) {
        currentClass = null;
      }
    }

    return { nodes, edges };
  }

  private extractBlock(
    lines: string[],
    startIndex: number,
  ): { endLine: number; bodyLines: string[] } {
    const bodyLines: string[] = [];
    let endLine = startIndex + 1;
    let depth = 0;
    let started = false;

    for (let j = startIndex; j < lines.length; j++) {
      const line = lines[j]!;
      bodyLines.push(line);
      endLine = j + 1;

      const opens = (line.match(/{/g) || []).length;
      const closes = (line.match(/}/g) || []).length;

      if (opens > 0) started = true;
      depth += opens - closes;

      if (started && depth <= 0) {
        break;
      }
    }

    return { endLine, bodyLines };
  }

  private extractCalls(bodyLines: string[]): string[] {
    const calls = new Set<string>();
    const callRegex =
      /(?:\b([a-zA-Z0-9_]+)\s*\(|this\.([a-zA-Z0-9_]+)\s*\(|\.([a-zA-Z0-9_]+)\s*\()/g;

    for (const line of bodyLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

      let match: RegExpExecArray | null;
      while ((match = callRegex.exec(line)) !== null) {
        const symbol = match[1] ?? match[2] ?? match[3];
        if (
          symbol &&
          !JAVA_BUILTINS.has(symbol) &&
          symbol !== 'if' &&
          symbol !== 'for' &&
          symbol !== 'while' &&
          symbol !== 'switch' &&
          symbol !== 'catch' &&
          symbol !== 'assert'
        ) {
          calls.add(symbol);
        }
      }
    }

    return Array.from(calls);
  }

  private inferTestTargets(methodName: string, calls: string[]): string[] {
    const targets = new Set<string>();

    if (methodName.startsWith('test')) {
      const stripped = methodName.replace(/^test_?/, '');
      targets.add(stripped.toLowerCase());
      targets.add(stripped);
    }

    for (const call of calls) {
      if (!call.startsWith('assert') && !call.startsWith('verify') && call.length > 2) {
        targets.add(call);
      }
    }

    return Array.from(targets);
  }
}
