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

const JS_BUILTINS = new Set([
  'log',
  'warn',
  'error',
  'info',
  'debug',
  'map',
  'filter',
  'reduce',
  'forEach',
  'find',
  'some',
  'every',
  'includes',
  'indexOf',
  'slice',
  'splice',
  'push',
  'pop',
  'shift',
  'unshift',
  'join',
  'split',
  'replace',
  'trim',
  'toLowerCase',
  'toUpperCase',
  'keys',
  'values',
  'entries',
  'assign',
  'stringify',
  'parse',
  'resolve',
  'reject',
  'then',
  'catch',
  'finally',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
]);

export class TsJsAstParser implements LanguageAstParser {
  supports(filePath: string): boolean {
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath);
  }

  parse(filePath: string, source: string): ParseResult {
    const nodes: CodeNode[] = [];
    const edges: CodeEdge[] = [];

    const lines = source.split('\n');
    const moduleName = filePath.replace(/\.[tj]sx?$/, '').replace(/[/\\]/g, '.');
    const moduleId = `module:${moduleName}`;

    // 1. Module node and imports
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

    for (const imp of imports) {
      edges.push({
        sourceId: moduleId,
        targetId: `module:${imp.sourceModule}`,
        kind: 'IMPORTS',
        metadata: { symbols: imp.importedSymbols },
      });
    }

    const isTestFile =
      filePath.includes('.test.') || filePath.includes('.spec.') || filePath.includes('__tests__');

    let currentClass: { name: string; id: string; braceDepth: number } | null = null;
    let braceDepth = 0;
    let lastParsedSchemaFields: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // Track braces
      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;

      // Class definition: class Foo extends Bar implements Baz {
      const classMatch = line.match(
        /(?:export\s+)?(?:default\s+)?class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\s+extends\s+([a-zA-Z_$][a-zA-Z0-9_$.]*))?(?:\s+implements\s+([^{]+))?/,
      );
      if (classMatch) {
        const className = classMatch[1]!;
        const baseClass = classMatch[2];
        const interfacesRaw = classMatch[3] ?? '';
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

        const classId = `class:${moduleName}.${className}`;
        const classNode: ClassNode = {
          id: classId,
          name: className,
          filePath,
          startLine: i + 1,
          endLine: Math.min(lines.length, i + 30), // approximated or closed by brace
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
      }

      // Mongoose Schema: const ProjectSchema = new mongoose.Schema({ ... })
      const schemaMatch = line.match(
        /(?:const|let|var)?\s*([a-zA-Z_$][a-zA-Z0-9_$]*Schema)\s*=\s*new\s+(?:mongoose\.)?Schema/i,
      );
      if (schemaMatch) {
        const schemaName = schemaMatch[1]!;
        const schemaId = `schema:${moduleName}.${schemaName}`;
        const block = this.extractBlock(lines, i);
        const fields = this.extractSchemaFields(block.bodyLines);
        lastParsedSchemaFields = fields;
        const fieldsDoc = fields.length > 0 ? ` (fields: ${fields.join(', ')})` : '';

        nodes.push({
          id: schemaId,
          name: schemaName,
          filePath,
          startLine: i + 1,
          endLine: block.endLine,
          kind: 'class',
          baseClasses: ['mongoose.Schema'],
          methods: [],
          docstring: `Mongoose Schema definition for ${schemaName}${fieldsDoc}`,
        });
        edges.push({
          sourceId: moduleId,
          targetId: schemaId,
          kind: 'DEFINES',
        });
      }

      // Mongoose Model: mongoose.model('Project', ...) or const Project = mongoose.model('Project', ...)
      const modelMatch = line.match(
        /(?:(?:const|let|var|module\.exports\s*=|export\s+default)\s+)?(?:([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*)?(?:mongoose\.)?model\s*\(\s*['"`]([a-zA-Z0-9_$]+)['"`]/i,
      );
      if (modelMatch) {
        const modelName = modelMatch[2] || modelMatch[1]!;
        const modelId = `model:${moduleName}.${modelName}`;
        const fieldsDoc =
          lastParsedSchemaFields.length > 0
            ? ` (fields: ${lastParsedSchemaFields.join(', ')})`
            : '';

        const modelNode: ClassNode = {
          id: modelId,
          name: modelName,
          filePath,
          startLine: i + 1,
          endLine: Math.min(lines.length, i + 35),
          kind: 'class',
          baseClasses: ['mongoose.Model'],
          methods: [],
          docstring: `Mongoose Database Model for ${modelName}${fieldsDoc}`,
        };
        nodes.push(modelNode);
        edges.push({
          sourceId: moduleId,
          targetId: modelId,
          kind: 'DEFINES',
        });
      }

      // Test blocks: it('...', ...) or test('...', ...)
      const testMatch = line.match(/(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/);
      if (testMatch) {
        const testTitle = testMatch[1]!;
        const testSlug = testTitle.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
        const testId = `test:${moduleName}.${testSlug}`;

        const block = this.extractBlock(lines, i);
        const calls = this.extractCalls(block.bodyLines);
        const targetSymbols = this.inferTestTargets(testTitle, calls);

        const testNode: TestNode = {
          id: testId,
          name: testTitle,
          filePath,
          startLine: i + 1,
          endLine: block.endLine,
          kind: 'test',
          targetSymbols,
          calls,
        };
        nodes.push(testNode);

        edges.push({
          sourceId: moduleId,
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
      }

      // Function definition: function foo(...) or const foo = (...) => or exports.foo = ... or methodName(...) {
      const funcMatch =
        line.match(
          /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)/,
        ) ||
        line.match(
          /(?:export\s+)?const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*[^=]+)?\s*=>/,
        ) ||
        line.match(
          /(?:module\.)?exports\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s*)?(?:function\s*)?\(([^)]*)\)\s*(?::\s*[^=]+)?\s*(?:=>|\{)/,
        ) ||
        (currentClass &&
          line.match(
            /^\s*(?:public|private|protected|async|static|\s)*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\s*\{/,
          ));

      if (funcMatch && !testMatch) {
        const funcName = funcMatch[1]!;
        if (funcName !== 'constructor' && funcName !== 'function' && funcName !== 'if') {
          const params = (funcMatch[2] ?? '')
            .split(',')
            .map((p) => p.trim().split(':')[0]!.trim())
            .filter((p) => p.length > 0);

          const isTest = isTestFile || funcName.startsWith('test');
          const block = this.extractBlock(lines, i);
          const calls = this.extractCalls(block.bodyLines);

          if (isTest) {
            const testId = `test:${moduleName}.${funcName}`;
            const targetSymbols = this.inferTestTargets(funcName, calls);
            const testNode: TestNode = {
              id: testId,
              name: funcName,
              filePath,
              startLine: i + 1,
              endLine: block.endLine,
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

            for (const target of targetSymbols) {
              edges.push({
                sourceId: testId,
                targetId: `func:${target}`,
                kind: 'TESTS',
              });
            }
          } else {
            const funcId = `func:${moduleName}.${funcName}`;
            let docstring: string | undefined;

            const isReactComponent =
              /^[A-Z]/.test(funcName) ||
              block.bodyLines.some((l) => /<[A-Za-z0-9]/.test(l) || /return\s*\(/.test(l));
            if (isReactComponent) {
              const renderedProps = this.extractReactRenderedProps(block.bodyLines);
              if (renderedProps.length > 0) {
                docstring = `React Component: ${funcName} (renders: ${renderedProps.slice(0, 6).join(', ')})`;
              }
            }

            const populates = this.extractPopulates(block.bodyLines);
            if (populates.length > 0) {
              docstring = docstring
                ? `${docstring}; populates: ${populates.join(', ')}`
                : `Controller function: ${funcName} (populates: ${populates.join(', ')})`;
            }

            const funcNode: FunctionNode = {
              id: funcId,
              name: funcName,
              filePath,
              startLine: i + 1,
              endLine: block.endLine,
              kind: 'function',
              isAsync: line.includes('async'),
              params,
              parentClass: currentClass ? currentClass.name : undefined,
              calls,
              docstring,
            };
            nodes.push(funcNode);

            edges.push({
              sourceId: currentClass ? currentClass.id : moduleId,
              targetId: funcId,
              kind: 'DEFINES',
            });

            if (currentClass) {
              const cNode = nodes.find((n) => n.id === currentClass!.id) as ClassNode;
              if (cNode) cNode.methods.push(funcName);
            }

            for (const call of calls) {
              edges.push({
                sourceId: funcId,
                targetId: `func:${call}`,
                kind: 'CALLS',
              });
            }
          }
        }
      }

      braceDepth += openBraces - closeBraces;
      if (currentClass && braceDepth < currentClass.braceDepth) {
        currentClass = null;
      }
    }

    return { nodes, edges };
  }

  private extractImports(lines: string[]): ImportStatement[] {
    const imports: ImportStatement[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();

      // import { a, b } from './module.js'
      const esmMatch = line.match(
        /import\s+(?:(\* as [a-zA-Z_$][a-zA-Z0-9_$]*)|([a-zA-Z_$][a-zA-Z0-9_$]*)|(?:\{([^}]+)\}))?\s*from\s*['"]([^'"]+)['"]/,
      );
      if (esmMatch) {
        const wildcard = esmMatch[1];
        const defaultImport = esmMatch[2];
        const namedImports = esmMatch[3];
        const sourceModule = esmMatch[4]!;

        const symbols: string[] = [];
        if (wildcard) symbols.push(wildcard.replace('* as ', ''));
        if (defaultImport) symbols.push(defaultImport);
        if (namedImports) {
          symbols.push(
            ...namedImports
              .split(',')
              .map((s) =>
                s
                  .trim()
                  .split(/\s+as\s+/)[0]!
                  .trim(),
              )
              .filter(Boolean),
          );
        }

        imports.push({
          sourceModule,
          importedSymbols: symbols,
          isWildcard: Boolean(wildcard),
          lineNumber: i + 1,
        });
        continue;
      }

      // const foo = require('bar')
      const cjsMatch = line.match(
        /(?:const|let|var)\s+(?:\{([^}]+)\}|([a-zA-Z_$][a-zA-Z0-9_$]*))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
      );
      if (cjsMatch) {
        const destructuring = cjsMatch[1];
        const defaultReq = cjsMatch[2];
        const sourceModule = cjsMatch[3]!;

        const symbols = destructuring
          ? destructuring.split(',').map((s) => s.trim().split(':')[0]!.trim())
          : defaultReq
            ? [defaultReq]
            : [];

        imports.push({
          sourceModule,
          importedSymbols: symbols,
          isWildcard: false,
          lineNumber: i + 1,
        });
      }
    }

    return imports;
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
      /(?:\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(|this\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\()/g;

    for (const line of bodyLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

      let match: RegExpExecArray | null;
      while ((match = callRegex.exec(line)) !== null) {
        const symbol = match[1] ?? match[2];
        if (
          symbol &&
          !JS_BUILTINS.has(symbol) &&
          symbol !== 'function' &&
          symbol !== 'if' &&
          symbol !== 'for'
        ) {
          calls.add(symbol);
        }
      }
    }

    return Array.from(calls);
  }

  private inferTestTargets(testTitleOrName: string, calls: string[]): string[] {
    const targets = new Set<string>();

    const tokens = testTitleOrName.split(/[\s_-]+/);
    for (const t of tokens) {
      if (t.length > 3 && !['should', 'test', 'when', 'with', 'that'].includes(t.toLowerCase())) {
        targets.add(t);
      }
    }

    for (const call of calls) {
      if (!call.startsWith('expect') && !call.startsWith('assert') && call.length > 2) {
        targets.add(call);
      }
    }

    return Array.from(targets);
  }

  private extractSchemaFields(bodyLines: string[]): string[] {
    const fields: string[] = [];
    const reserved = new Set([
      'type',
      'required',
      'ref',
      'default',
      'timestamps',
      'unique',
      'trim',
      'min',
      'max',
      'minlength',
      'maxlength',
      'enum',
      'validate',
      'select',
      'index',
      'sparse',
      'set',
      'get',
      'transform',
      '_id',
      'id',
    ]);
    const fieldRegex = /^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*[{a-zA-Z[]/;
    for (const line of bodyLines) {
      const match = line.match(fieldRegex);
      if (match) {
        const field = match[1]!;
        if (!reserved.has(field) && !fields.includes(field)) {
          fields.push(field);
        }
      }
    }
    return fields;
  }

  private extractReactRenderedProps(bodyLines: string[]): string[] {
    const props = new Set<string>();
    const propRegex = /\{([a-zA-Z_$][a-zA-Z0-9_$]*\.[a-zA-Z0-9_$.]+)\}/g;
    for (const line of bodyLines) {
      let match: RegExpExecArray | null;
      while ((match = propRegex.exec(line)) !== null) {
        props.add(match[1]!);
      }
    }
    return Array.from(props);
  }

  private extractPopulates(bodyLines: string[]): string[] {
    const populates: string[] = [];
    const populateRegex = /\.populate\s*\(\s*['"`]([a-zA-Z0-9_$]+)['"`]\s*\)/g;
    for (const line of bodyLines) {
      let match: RegExpExecArray | null;
      while ((match = populateRegex.exec(line)) !== null) {
        const popTarget = match[1]!;
        if (!populates.includes(popTarget)) {
          populates.push(popTarget);
        }
      }
    }
    return populates;
  }
}
