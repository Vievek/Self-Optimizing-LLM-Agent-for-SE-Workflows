import { ToolsConfig, CONFIG_SCHEMA_VERSION } from '@soa/contracts';

/**
 * Standard tool specifications aligned with Claude Code / Antigravity / SWE-agent standards.
 */
export const TOOL_DEFINITIONS = {
  read_file: {
    name: 'read_file',
    description:
      'Read file contents from workspace. Supports reading a single file via "path" or batch-reading multiple files via "paths: string[]".',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to a single file in the workspace' },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of relative file paths to batch-read in a single call',
        },
        offset: { type: 'number', description: '1-based line number to start reading from' },
        limit: { type: 'number', description: 'Maximum number of lines to read' },
      },
    },
    timeout_s: 30,
  },
  write_file: {
    name: 'write_file',
    description:
      'Write complete content to one or multiple files in workspace. Supports single file ("path" and "content") or batch writing ("files: Array<{ path, content }>").',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to a single file to create or overwrite' },
        content: { type: 'string', description: 'Full UTF-8 text content to write' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative file path' },
              content: { type: 'string', description: 'Full UTF-8 text content' },
            },
            required: ['path', 'content'],
          },
          description: 'Array of files to batch write in one turn (recommended: 2-3 files per batch)',
        },
      },
    },
    timeout_s: 30,
  },
  edit_file: {
    name: 'edit_file',
    description: 'Precisely replace an exact string occurrence with new content in a target file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the target file' },
        old_str: { type: 'string', description: 'The exact string snippet to be replaced' },
        new_str: { type: 'string', description: 'The replacement string snippet' },
      },
      required: ['path', 'old_str', 'new_str'],
    },
    timeout_s: 30,
  },
  run_command: {
    name: 'run_command',
    description:
      'Execute a bash command in the workspace sandbox and return stdout, stderr, and exit code.',
    parameters: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'The shell command to execute' },
        timeout_ms: { type: 'number', description: 'Execution timeout in milliseconds' },
      },
      required: ['cmd'],
    },
    timeout_s: 120,
  },
  run_tests: {
    name: 'run_tests',
    description: 'Run targeted unit or integration tests in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        test_cmd: { type: 'string', description: 'Custom test command (e.g. pytest or npm test)' },
        test_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of specific test file paths or IDs to run',
        },
      },
    },
    timeout_s: 180,
  },
  retrieve_context: {
    name: 'retrieve_context',
    description:
      'Retrieve AST code graph symbols, relationships, definitions, and callers for a given query.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol, function, class, or keyword to retrieve' },
        hops: { type: 'number', description: 'Graph traversal hop depth (1 to 3)' },
      },
      required: ['query'],
    },
    timeout_s: 30,
  },
  list_directory: {
    name: 'list_directory',
    description:
      'List files and subdirectories recursively up to depth 4 by default, showing full project structure in one call. Avoid querying subdirectories individually.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory path (defaults to root ".")' },
        depth: {
          type: 'number',
          description: 'Directory traversal depth (1 to 6, defaults to 4)',
        },
      },
    },
    timeout_s: 30,
  },
  grep_search: {
    name: 'grep_search',
    description: 'Search for regex or text pattern occurrences across workspace files.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex or text pattern to search for' },
        path: {
          type: 'string',
          description: 'Directory or file to search within (defaults to ".")',
        },
      },
      required: ['pattern'],
    },
    timeout_s: 60,
  },
} as const;

/**
 * Creates a valid ToolsConfig adhering to the @soa/contracts ToolsConfigSchema.
 */
export function createDefaultToolsConfig(): ToolsConfig {
  return {
    schema_version: CONFIG_SCHEMA_VERSION,
    tools: { ...TOOL_DEFINITIONS },
  };
}
