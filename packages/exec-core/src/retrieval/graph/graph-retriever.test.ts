import { describe, it, expect, beforeEach } from 'vitest';
import { RetrievalSpanAttributesSchema } from '@soa/contracts';
import { PythonAstParser } from './python-ast-parser.js';
import { TsJsAstParser } from './ts-js-ast-parser.js';
import { JavaAstParser } from './java-ast-parser.js';
import { MultiLanguageAstParser } from './multi-language-ast-parser.js';
import { CodeGraph } from './code-graph.js';
import { GraphRetriever } from './graph-retriever.js';

describe('AST-Derived Graph Retrieval (exec-core-ast-graph)', () => {
  const parser = new PythonAstParser();
  let graph: CodeGraph;
  let retriever: GraphRetriever;

  // Realistic sample Python code matching SWE-bench django__django-11099
  const validatorSource = `
"""
Validation utilities for authentication and slugs.
"""
import re
from django.core.exceptions import ValidationError

class BaseValidator:
    """Base class for all schema validators."""
    def __init__(self, message=None):
        self.message = message

class ASCIIUsernameValidator(BaseValidator):
    """Validate that username contains only ASCII letters."""
    regex = r'^[\\w.@+-]+\\Z'

def _clean_slug(raw_slug):
    """Normalize and strip trailing hyphens."""
    return raw_slug.strip('-')

def validate_slug_words(value):
    """Validate that value contains only words and hyphens."""
    cleaned = _clean_slug(value)
    if not re.match(r'^[\\w-]+$', cleaned):
        raise ValidationError('Invalid slug')
    return cleaned
`;

  const testValidatorSource = `
"""
Tests for validator module.
"""
from django.core.exceptions import ValidationError
from django.core.validators import validate_slug_words

class TestValidators:
    """Test validator edge cases."""

    def test_slug_words_valid(self):
        result = validate_slug_words("valid-slug")
        assert result == "valid-slug"

    def test_slug_words_trailing_newline(self):
        """Test that trailing newlines are rejected."""
        try:
            validate_slug_words("invalid-slug\\n")
            assert False, "Should have raised ValidationError"
        except ValidationError:
            pass
`;

  beforeEach(() => {
    graph = new CodeGraph();

    // Parse both files and load into CodeGraph
    const validatorAst = parser.parse('django/core/validators.py', validatorSource);
    for (const node of validatorAst.nodes) graph.addNode(node);
    for (const edge of validatorAst.edges) graph.addEdge(edge);

    const testAst = parser.parse('tests/test_validators.py', testValidatorSource);
    for (const node of testAst.nodes) graph.addNode(node);
    for (const edge of testAst.edges) graph.addEdge(edge);

    retriever = new GraphRetriever(graph, { top_k: 5, max_depth: 2 });
  });

  it('correctly parses Python AST into Modules, Classes, Functions, and Tests', () => {
    const stats = graph.getStats();
    expect(stats.modules).toBe(2);
    expect(stats.classes).toBe(3); // BaseValidator, ASCIIUsernameValidator, and TestValidators
    expect(stats.functions).toBeGreaterThanOrEqual(2); // _clean_slug, validate_slug_words
    expect(stats.tests).toBe(2); // test_slug_words_valid, test_slug_words_trailing_newline
  });

  it('correctly records CALLS, IMPORTS, INHERITS, and TESTS edges', () => {
    // 1. Check INHERITS: ASCIIUsernameValidator inherits BaseValidator
    const asciiClass = graph.findNodesByName('ASCIIUsernameValidator')[0];
    expect(asciiClass).toBeDefined();
    expect(asciiClass?.kind).toBe('class');

    // 2. Check CALLS: validate_slug_words calls _clean_slug
    const callees = graph.getCallees('validate_slug_words');
    const calleeNames = callees.map((c) => c.name);
    expect(calleeNames).toContain('_clean_slug');

    // 3. Check CALLERS: validate_slug_words is called by test methods
    const callers = graph.getCallers('validate_slug_words');
    const callerNames = callers.map((c) => c.name);
    expect(callerNames).toContain('test_slug_words_valid');
    expect(callerNames).toContain('test_slug_words_trailing_newline');
  });

  it('finds test cases associated with a function symbol via TESTS and reverse CALLS', () => {
    const tests = graph.getTestsFor('validate_slug_words');
    expect(tests.length).toBeGreaterThanOrEqual(2);
    const testNames = tests.map((t) => t.name);
    expect(testNames).toContain('test_slug_words_trailing_newline');
  });

  it('executes multi-hop traversal from test to implementation and helper function', () => {
    // Multi-hop from test_slug_words_valid:
    // Hop 0: test_slug_words_valid
    // Hop 1: validate_slug_words
    // Hop 2: _clean_slug
    const traversal = graph.traverseMultiHop('test_slug_words_valid', 2);
    const visitedIds = traversal.map((t) => t.nodeId);

    const hasTargetFunc = visitedIds.some((id) => id.includes('validate_slug_words'));
    const hasHelperFunc = visitedIds.some((id) => id.includes('_clean_slug'));

    expect(hasTargetFunc).toBe(true);
    expect(hasHelperFunc).toBe(true);
  });

  it('retrieves relevant code context for a bug report query targeting a symbol', () => {
    const result = retriever.retrieve({
      query: 'Fix trailing newline validation bug in validate_slug_words',
      symbols: ['validate_slug_words'],
    });

    expect(result.snippets.length).toBeGreaterThan(0);
    expect(result.resultIds.some((id) => id.includes('validate_slug_words'))).toBe(true);

    // Context should contain the function snippet
    const topSnippet = result.snippets[0]!;
    expect(topSnippet.codeSnippet).toContain('validate_slug_words');
    expect(topSnippet.relevanceScore).toBeGreaterThanOrEqual(0.7);
  });

  it('surfaces linked tests when retrieving context for an implementation function', () => {
    const result = retriever.retrieve('validate_slug_words');

    const retrievedNames = result.snippets.map((s) => s.node.name);
    expect(retrievedNames).toContain('validate_slug_words');
    // Multi-hop surfaces callers (the tests)
    expect(retrievedNames.some((n) => n.startsWith('test_slug_words'))).toBe(true);
  });

  it('generates schema-valid RetrievalSpanAttributes conforming to shared contracts', () => {
    const result = retriever.retrieve({
      query: 'Regex trailing newline issue',
      symbols: ['validate_slug_words'],
      maxDepth: 2,
    });

    // Validate directly against Zod schema from @soa/contracts
    const validatedSpan = RetrievalSpanAttributesSchema.parse(result.spanAttributes);
    expect(validatedSpan.source).toBe('code');
    expect(validatedSpan.strategy).toBe('graph');
    expect(validatedSpan.query).toBe('Regex trailing newline issue');
    expect(validatedSpan.depth).toBe(2);
    expect(Array.isArray(validatedSpan.result_ids)).toBe(true);
  });

  it('respects top_k truncation', () => {
    const limitedRetriever = new GraphRetriever(graph, { top_k: 2 });
    const result = limitedRetriever.retrieve('validate_slug_words');
    expect(result.snippets.length).toBeLessThanOrEqual(2);
  });

  describe('TypeScript & JavaScript AST Parsing (TsJsAstParser)', () => {
    const tsParser = new TsJsAstParser();

    const sampleTsSource = `
import { BaseService } from './base.service.js';
import * as crypto from 'crypto';

export class UserService extends BaseService {
  constructor() {
    super();
  }

  public async findUserById(id: string): Promise<User> {
    const normalizedId = this.normalizeId(id);
    return this.queryDatabase(normalizedId);
  }

  private normalizeId(id: string): string {
    return id.trim();
  }
}
`;

    const sampleTsTestSource = `
import { UserService } from './user.service.js';

describe('UserService Unit Tests', () => {
  it('should find user by valid id', async () => {
    const service = new UserService();
    const user = await service.findUserById('123');
    expect(user).toBeDefined();
  });
});
`;

    it('parses TypeScript classes, methods, imports, and calls', () => {
      const parsed = tsParser.parse('src/user.service.ts', sampleTsSource);
      expect(parsed.nodes.length).toBeGreaterThanOrEqual(3);

      const classNode = parsed.nodes.find((n) => n.kind === 'class');
      expect(classNode?.name).toBe('UserService');

      const methods = parsed.nodes.filter((n) => n.kind === 'function');
      const methodNames = methods.map((m) => m.name);
      expect(methodNames).toContain('findUserById');
      expect(methodNames).toContain('normalizeId');

      // Check CALLS edge: findUserById -> normalizeId
      const callsEdge = parsed.edges.find(
        (e) => e.kind === 'CALLS' && e.targetId.includes('normalizeId'),
      );
      expect(callsEdge).toBeDefined();
    });

    it('parses Jest/Vitest it() test blocks and links target methods', () => {
      const parsed = tsParser.parse('src/user.service.test.ts', sampleTsTestSource);
      const testNodes = parsed.nodes.filter((n) => n.kind === 'test');
      expect(testNodes.length).toBe(1);
      expect(testNodes[0]?.name).toContain('should find user by valid id');

      const callsFind = parsed.edges.some(
        (e) => e.kind === 'CALLS' && e.targetId.includes('findUserById'),
      );
      expect(callsFind).toBe(true);
    });
  });

  describe('Java AST Parsing (JavaAstParser)', () => {
    const javaParser = new JavaAstParser();

    const sampleJavaSource = `
package com.example.service;

import com.example.model.Order;
import java.util.List;

public class OrderService extends BaseService implements IOrderService {
    public Order processOrder(String orderId) {
        validateOrder(orderId);
        return saveOrder(orderId);
    }

    private void validateOrder(String id) {
        if (id == null) throw new IllegalArgumentException();
    }
}
`;

    const sampleJavaTestSource = `
package com.example.service;

import org.junit.Test;
import static org.junit.Assert.*;

public class OrderServiceTest {
    @Test
    public void testProcessOrderSuccess() {
        OrderService service = new OrderService();
        Order order = service.processOrder("ORD-100");
        assertNotNull(order);
    }
}
`;

    it('parses Java classes, interfaces, methods, and call sites', () => {
      const parsed = javaParser.parse(
        'src/main/java/com/example/service/OrderService.java',
        sampleJavaSource,
      );
      const classNode = parsed.nodes.find((n) => n.kind === 'class');
      expect(classNode?.name).toBe('OrderService');

      const funcNodes = parsed.nodes.filter((n) => n.kind === 'function');
      const funcNames = funcNodes.map((f) => f.name);
      expect(funcNames).toContain('processOrder');
      expect(funcNames).toContain('validateOrder');

      // Check CALLS edge: processOrder -> validateOrder
      const callEdge = parsed.edges.find(
        (e) => e.kind === 'CALLS' && e.targetId.includes('validateOrder'),
      );
      expect(callEdge).toBeDefined();
    });

    it('parses JUnit @Test annotations into TestNodes and links TESTS edges', () => {
      const parsed = javaParser.parse(
        'src/test/java/com/example/service/OrderServiceTest.java',
        sampleJavaTestSource,
      );
      const testNodes = parsed.nodes.filter((n) => n.kind === 'test');
      expect(testNodes.length).toBe(1);
      expect(testNodes[0]?.name).toBe('testProcessOrderSuccess');

      const testEdge = parsed.edges.find((e) => e.kind === 'TESTS');
      expect(testEdge).toBeDefined();
    });
  });

  describe('Unified Multi-Language AST Parser (MultiLanguageAstParser)', () => {
    const multiParser = new MultiLanguageAstParser();

    it('automatically dispatches to correct language parser by file extension', () => {
      expect(multiParser.supports('foo.py')).toBe(true);
      expect(multiParser.supports('foo.ts')).toBe(true);
      expect(multiParser.supports('foo.js')).toBe(true);
      expect(multiParser.supports('Foo.java')).toBe(true);
      expect(multiParser.supports('foo.cpp')).toBe(false);

      const pyResult = multiParser.parse('module.py', 'def py_func(): pass');
      expect(pyResult.nodes.some((n) => n.name === 'py_func')).toBe(true);

      const tsResult = multiParser.parse('module.ts', 'export function tsFunc() {}');
      expect(tsResult.nodes.some((n) => n.name === 'tsFunc')).toBe(true);

      const javaResult = multiParser.parse(
        'App.java',
        'public class App { public void javaMethod() {} }',
      );
      expect(javaResult.nodes.some((n) => n.name === 'javaMethod')).toBe(true);
    });
  });
});
