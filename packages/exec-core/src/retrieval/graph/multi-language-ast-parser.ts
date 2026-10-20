import { LanguageAstParser, ParseResult } from './types.js';
import { PythonAstParser } from './python-ast-parser.js';
import { TsJsAstParser } from './ts-js-ast-parser.js';
import { JavaAstParser } from './java-ast-parser.js';

/**
 * Unified AST Parser supporting multi-language repositories.
 * Dispatches parsing to PythonAstParser, TsJsAstParser, or JavaAstParser based on file extension.
 */
export class MultiLanguageAstParser implements LanguageAstParser {
  private readonly parsers: LanguageAstParser[];

  constructor(customParsers?: LanguageAstParser[]) {
    this.parsers = customParsers ?? [
      new PythonAstParser(),
      new TsJsAstParser(),
      new JavaAstParser(),
    ];
  }

  supports(filePath: string): boolean {
    return this.parsers.some((p) => p.supports(filePath));
  }

  parse(filePath: string, source: string): ParseResult {
    const parser = this.parsers.find((p) => p.supports(filePath));
    if (!parser) {
      throw new Error(`Unsupported language or file extension for AST parsing: ${filePath}`);
    }
    return parser.parse(filePath, source);
  }

  registerParser(parser: LanguageAstParser): void {
    this.parsers.unshift(parser);
  }
}
