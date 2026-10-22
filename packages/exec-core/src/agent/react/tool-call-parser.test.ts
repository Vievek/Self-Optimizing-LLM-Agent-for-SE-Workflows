import { describe, it, expect } from 'vitest';
import { ToolCallParser, sanitizeJsonString } from './tool-call-parser.js';

describe('ToolCallParser', () => {
  describe('ReAct Syntax Parsing', () => {
    it('parses standard Thought, Action, and Action Input', () => {
      const output = `Thought: I should search for the error handler in the codebase.
Action: grep_search
Action Input: {"query": "handleError", "path": "src"}`;

      const result = ToolCallParser.parse(output);

      expect(result.isFinal).toBe(false);
      expect(result.thought).toBe('I should search for the error handler in the codebase.');
      expect(result.toolCall).toBeDefined();
      expect(result.toolCall?.toolName).toBe('grep_search');
      expect(result.toolCall?.args).toEqual({ query: 'handleError', path: 'src' });
    });

    it('parses ReAct with Markdown JSON block inside Action Input', () => {
      const output = `Thought: Let's read the index file to inspect imports.
Action: read_file
Action Input:
\`\`\`json
{
  "path": "src/index.ts",
  "offset": 1,
  "limit": 50
}
\`\`\``;

      const result = ToolCallParser.parse(output);

      expect(result.isFinal).toBe(false);
      expect(result.thought).toBe("Let's read the index file to inspect imports.");
      expect(result.toolCall?.toolName).toBe('read_file');
      expect(result.toolCall?.args).toEqual({
        path: 'src/index.ts',
        offset: 1,
        limit: 50,
      });
    });

    it('recovers plain string Action Input by intelligently mapping tool parameters', () => {
      const output = `Thought: I need to check the current directory contents.
Action: list_directory
Action Input: ./src`;

      const result = ToolCallParser.parse(output);

      expect(result.isFinal).toBe(false);
      expect(result.toolCall?.toolName).toBe('list_directory');
      expect(result.toolCall?.args).toEqual({ path: './src' });
    });

    it('handles trailing commas and single quotes in Action Input', () => {
      const output = `Thought: Checking tests.
Action: run_tests
Action Input: {'test_ids': ['tests/unit.test.ts',],}`;

      const result = ToolCallParser.parse(output);

      expect(result.isFinal).toBe(false);
      expect(result.toolCall?.toolName).toBe('run_tests');
      expect(result.toolCall?.args).toEqual({ test_ids: ['tests/unit.test.ts'] });
    });
  });

  describe('Direct Markdown JSON Tool Calls', () => {
    it('parses { tool, parameters } format from markdown code blocks', () => {
      const output = `I will run a command to check git status.
\`\`\`json
{
  "tool": "run_command",
  "parameters": {
    "command": "git status"
  }
}
\`\`\``;

      const result = ToolCallParser.parse(output);

      expect(result.isFinal).toBe(false);
      expect(result.toolCall?.toolName).toBe('run_command');
      expect(result.toolCall?.args).toEqual({ command: 'git status' });
    });

    it('parses OpenAI-style { name, arguments } format', () => {
      const output = `\`\`\`json
{
  "name": "edit_file",
  "arguments": {
    "path": "src/app.ts",
    "target": "const a = 1;",
    "replacement": "const a = 2;"
  }
}
\`\`\``;

      const result = ToolCallParser.parse(output);

      expect(result.isFinal).toBe(false);
      expect(result.toolCall?.toolName).toBe('edit_file');
      expect(result.toolCall?.args).toEqual({
        path: 'src/app.ts',
        target: 'const a = 1;',
        replacement: 'const a = 2;',
      });
    });

    it('parses multiple tool calls in an array', () => {
      const output = `\`\`\`json
[
  { "tool": "read_file", "parameters": { "path": "file1.ts" } },
  { "tool": "read_file", "parameters": { "path": "file2.ts" } }
]
\`\`\``;

      const result = ToolCallParser.parse(output);

      expect(result.isFinal).toBe(false);
      expect(result.toolCall?.toolName).toBe('read_file');
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls?.[1]?.args).toEqual({ path: 'file2.ts' });
    });
  });

  describe('Final Answer & Conversational Output', () => {
    it('parses explicit Thought and Final Answer', () => {
      const output = `Thought: All test suites passed and the bug is resolved.
Final Answer: Fixed the regex pattern in auth.ts to properly validate email addresses.`;

      const result = ToolCallParser.parse(output);

      expect(result.isFinal).toBe(true);
      expect(result.thought).toBe('All test suites passed and the bug is resolved.');
      expect(result.finalAnswer).toBe(
        'Fixed the regex pattern in auth.ts to properly validate email addresses.',
      );
      expect(result.toolCall).toBeUndefined();
    });

    it('treats conversational plain text without tool calls as final answer', () => {
      const output =
        'The task is already complete. All required files are in place and lint checks pass.';

      const result = ToolCallParser.parse(output);

      expect(result.isFinal).toBe(true);
      expect(result.finalAnswer).toBe(output);
      expect(result.toolCall).toBeUndefined();
    });
  });

  describe('sanitizeJsonString helper', () => {
    it('removes trailing commas and normalizes quotes', () => {
      const input = `{'path': 'src/main.ts', 'limit': 20,}`;
      const sanitized = sanitizeJsonString(input);
      expect(JSON.parse(sanitized)).toEqual({
        path: 'src/main.ts',
        limit: 20,
      });
    });
  });
});
