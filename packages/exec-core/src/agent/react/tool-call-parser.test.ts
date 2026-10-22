import { describe, it, expect } from 'vitest';
import {
  ToolCallParser,
  sanitizeJsonString,
  fixRawNewlinesInJson,
  repairTruncatedJson,
} from './tool-call-parser.js';

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

    it('parses ReAct syntax with markdown bolded keywords (**Action**, **Thought**)', () => {
      const output = `**Thought**: Let's check what files exist in the workspace.
**Action**: list_directory
**Action Input**: {"path": "."}`;

      const result = ToolCallParser.parse(output);

      expect(result.isFinal).toBe(false);
      expect(result.thought).toBe("Let's check what files exist in the workspace.");
      expect(result.toolCall?.toolName).toBe('list_directory');
      expect(result.toolCall?.args).toEqual({ path: '.' });
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

  describe('XML Tool Call Parsing', () => {
    it('parses Qwen-style <tool_call><list_directory><parameter=path>.</parameter></tool_call>', () => {
      const output = `I'll start by exploring the current state of the workspace.

<tool_call>
<list_directory>
<parameter=path>
.
</parameter>
</function>
</tool_call>`;

      const result = ToolCallParser.parse(output);
      expect(result.isFinal).toBe(false);
      expect(result.toolCall?.toolName).toBe('list_directory');
      expect(result.toolCall?.args).toEqual({ path: '.' });
    });

    it('parses Qwen-style <tool_call><function=write_file> with multiple parameters', () => {
      const output = `Creating server entry.
<tool_call>
<function=write_file>
<parameter=path>
server/src/index.js
</parameter>
<parameter=content>
console.log("hello");
</parameter>
</function>
</tool_call>`;

      const result = ToolCallParser.parse(output);
      expect(result.isFinal).toBe(false);
      expect(result.toolCall?.toolName).toBe('write_file');
      expect(result.toolCall?.args).toEqual({
        path: 'server/src/index.js',
        content: 'console.log("hello");',
      });
    });

    it('does not parse <tool_call> as tool name when Action is followed by newlines and XML', () => {
      const output = `Thought: Let me explore.
Action:

<tool_call>
<function=list_directory>
</function>
</tool_call>`;
      const parsed = ToolCallParser.parse(output);
      expect(parsed.toolCall?.toolName).toBe('list_directory');
      expect(parsed.toolCall?.args).toEqual({ path: '.' });
    });
  });

  describe('Batch Payload Recovery and Raw Newline Handling', () => {
    it('escapes raw unescaped newlines inside JSON string literals', () => {
      const badJson = '{"path": "test.txt", "content": "line1\nline2"}';
      const fixed = fixRawNewlinesInJson(badJson);
      expect(JSON.parse(fixed)).toEqual({
        path: 'test.txt',
        content: 'line1\nline2',
      });
    });

    it('recovers completed files from a truncated batch write payload', () => {
      const truncated = `{
  "files": [
    { "path": "client/src/f1.js", "content": "console.log(1);" },
    { "path": "client/src/f2.js", "content": "console.log(2);" },
    { "path": "client/src/f3.js", "content": "console.log(3`;

      const recovered = repairTruncatedJson(truncated);
      expect(recovered).not.toBeNull();
      expect(recovered?.truncated).toBe(true);
      expect(recovered?.files).toEqual([
        { path: 'client/src/f1.js', content: 'console.log(1);' },
        { path: 'client/src/f2.js', content: 'console.log(2);' },
      ]);
    });

    it('parses ReAct Action Input with truncated batch write and returns completed files', () => {
      const output = `Thought: Writing files in batch.
Action: write_file
Action Input: {
  "files": [
    { "path": "button.jsx", "content": "export const Button = () => null;" },
    { "path": "input.jsx", "content": "export const Input = () => null;" },
    { "path": "card.jsx", "content": "export const Card = () => {
`;

      const parsed = ToolCallParser.parse(output);
      expect(parsed.toolCall?.toolName).toBe('write_file');
      expect(parsed.toolCall?.args.files).toHaveLength(2);
      expect(parsed.toolCall?.args.truncated).toBe(true);
    });

    it('rejects treating malformed JSON as raw file path in write_file fallback', () => {
      const output = `Thought: Attempting to write.
Action: write_file
Action Input: { "files": [ { invalid_syntax `;

      const parsed = ToolCallParser.parse(output);
      expect(parsed.toolCall?.toolName).toBe('write_file');
      expect(parsed.toolCall?.args.path).toBeUndefined();
      expect(parsed.toolCall?.args.error).toBeDefined();
    });
  });
});
