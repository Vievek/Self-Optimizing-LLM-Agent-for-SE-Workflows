import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FixtureSandboxService } from '@soa/sandbox';
import { ToolCallSpanAttributesSchema } from '@soa/contracts';
import { createDefaultToolRegistry } from './tool-registry.js';
import { ToolExecutor } from './tool-executor.js';
import { ToolContext } from '../types.js';
import { CodeGraph } from '../../retrieval/graph/code-graph.js';
import { GraphRetriever } from '../../retrieval/graph/graph-retriever.js';

describe('ToolExecutor and ACI Standard Tools', () => {
  let sandbox: FixtureSandboxService;
  let wsId: string;
  let registry: ReturnType<typeof createDefaultToolRegistry>;
  let executor: ToolExecutor;
  let context: ToolContext;

  beforeEach(async () => {
    sandbox = new FixtureSandboxService();
    wsId = await sandbox.createWorkspace('test__task', 'head');
    registry = createDefaultToolRegistry();
    executor = new ToolExecutor(registry);
    context = {
      workspaceId: wsId,
      sandbox,
      taskId: 'test__task',
    };
  });

  afterEach(async () => {
    if (sandbox && wsId) {
      await sandbox.destroy(wsId);
    }
  });

  it('initializes default registry with all 8 standard tools', () => {
    const names = registry.getNames();
    expect(names).toEqual([
      'read_file',
      'write_file',
      'edit_file',
      'run_command',
      'run_tests',
      'retrieve_context',
      'list_directory',
      'grep_search',
    ]);
  });

  it('handles unknown tool call gracefully with valid span attributes', async () => {
    const { result, spanAttributes } = await executor.execute(
      {
        toolName: 'unknown_magic_tool',
        args: { foo: 'bar' },
        retryOf: 'retry_001',
      },
      context,
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('not registered');

    // Strict contracts validation
    const parsed = ToolCallSpanAttributesSchema.safeParse(spanAttributes);
    expect(parsed.success).toBe(true);
    expect(spanAttributes.tool_name).toBe('unknown_magic_tool');
    expect(spanAttributes.retry_of).toBe('retry_001');
    expect(spanAttributes.status).toBe('error');
  });

  it('executes write_file, read_file with offset and limit', async () => {
    const content = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'].join('\n');

    // 1. write_file
    const writeResp = await executor.execute(
      {
        toolName: 'write_file',
        args: { path: 'src/example.txt', content },
      },
      context,
    );

    expect(writeResp.result.status).toBe('ok');
    expect(writeResp.spanAttributes.status).toBe('ok');
    expect(ToolCallSpanAttributesSchema.safeParse(writeResp.spanAttributes).success).toBe(true);

    // 2. read_file (full)
    const readRespFull = await executor.execute(
      {
        toolName: 'read_file',
        args: { path: 'src/example.txt' },
      },
      context,
    );
    expect(readRespFull.result.status).toBe('ok');
    expect(readRespFull.result.output).toContain('1 | line 1');
    expect(readRespFull.result.output).toContain('5 | line 5');

    // 3. read_file with offset and limit
    const readRespSlice = await executor.execute(
      {
        toolName: 'read_file',
        args: { path: 'src/example.txt', offset: 2, limit: 2 },
      },
      context,
    );
    expect(readRespSlice.result.status).toBe('ok');
    expect(readRespSlice.result.output).toBe('2 | line 2\n3 | line 3');

    // 4. read_file in batch mode across multiple files
    await executor.execute(
      { toolName: 'write_file', args: { path: 'src/file2.txt', content: 'alpha\nbeta' } },
      context,
    );
    const batchResp = await executor.execute(
      {
        toolName: 'read_file',
        args: { paths: ['src/example.txt', 'src/file2.txt'] },
      },
      context,
    );
    expect(batchResp.result.status).toBe('ok');
    expect(batchResp.result.output).toContain('=== File: src/example.txt');
    expect(batchResp.result.output).toContain('=== File: src/file2.txt');
    expect(batchResp.result.output).toContain('alpha');

    // 5. write_file in batch mode across multiple files
    const batchWriteResp = await executor.execute(
      {
        toolName: 'write_file',
        args: {
          files: [
            { path: 'batch_dir/b1.js', content: 'console.log("b1");' },
            { path: 'batch_dir/b2.js', content: 'console.log("b2");' },
          ],
        },
      },
      context,
    );
    expect(batchWriteResp.result.status).toBe('ok');
    expect(batchWriteResp.result.output).toContain('Successfully wrote 2 files');
    expect(batchWriteResp.result.output).toContain('batch_dir/b1.js');
    expect(batchWriteResp.result.output).toContain('batch_dir/b2.js');
  });

  it('executes edit_file with precision matching', async () => {
    await executor.execute(
      {
        toolName: 'write_file',
        args: {
          path: 'calc.py',
          content: 'def calculate(a, b):\n    return a + b\n',
        },
      },
      context,
    );

    // Edit success
    const editResp = await executor.execute(
      {
        toolName: 'edit_file',
        args: {
          path: 'calc.py',
          old_str: 'return a + b',
          new_str: 'return a * b',
        },
      },
      context,
    );

    expect(editResp.result.status).toBe('ok');
    expect(editResp.spanAttributes.status).toBe('ok');

    // Verify content
    const verifyResp = await executor.execute(
      {
        toolName: 'read_file',
        args: { path: 'calc.py' },
      },
      context,
    );
    expect(verifyResp.result.output).toContain('return a * b');

    // Edit failure on non-existent string
    const failResp = await executor.execute(
      {
        toolName: 'edit_file',
        args: {
          path: 'calc.py',
          old_str: 'non_existent_code',
          new_str: 'anything',
        },
      },
      context,
    );
    expect(failResp.result.status).toBe('error');
    expect(failResp.result.error).toContain('not found');
  });

  it('fails edit_file when old_str matches multiple occurrences', async () => {
    await executor.execute(
      {
        toolName: 'write_file',
        args: {
          path: 'repeated.txt',
          content: 'duplicate\nmiddle\nduplicate\n',
        },
      },
      context,
    );

    const dupResp = await executor.execute(
      {
        toolName: 'edit_file',
        args: {
          path: 'repeated.txt',
          old_str: 'duplicate',
          new_str: 'replacement',
        },
      },
      context,
    );

    expect(dupResp.result.status).toBe('error');
    expect(dupResp.result.error).toContain('found 2 times');
  });

  it('executes run_command and returns stdout and exit status', async () => {
    const cmdResp = await executor.execute(
      {
        toolName: 'run_command',
        args: { cmd: 'echo "hello agent world"' },
      },
      context,
    );

    expect(cmdResp.result.status).toBe('ok');
    expect(cmdResp.result.output).toContain('hello agent world');
    expect(cmdResp.spanAttributes.status).toBe('ok');
    expect(ToolCallSpanAttributesSchema.safeParse(cmdResp.spanAttributes).success).toBe(true);
  });

  it('executes list_directory and grep_search', async () => {
    await executor.execute(
      {
        toolName: 'write_file',
        args: {
          path: 'services/auth.ts',
          content: 'export function authenticateUser(token: string) { return true; }',
        },
      },
      context,
    );

    // List directory
    const listResp = await executor.execute(
      {
        toolName: 'list_directory',
        args: { path: '.' },
      },
      context,
    );
    expect(listResp.result.status).toBe('ok');
    expect(listResp.result.output).toContain('services');

    // Grep search
    const grepResp = await executor.execute(
      {
        toolName: 'grep_search',
        args: { pattern: 'authenticateUser' },
      },
      context,
    );
    expect(grepResp.result.status).toBe('ok');
    expect(grepResp.result.output).toContain('services/auth.ts');
  });

  it('executes retrieve_context with attached GraphRetriever', async () => {
    const graph = new CodeGraph();
    graph.addNode({
      id: 'src/auth.ts::loginUser',
      name: 'loginUser',
      kind: 'function',
      isAsync: false,
      params: ['credentials'],
      calls: [],
      filePath: 'src/auth.ts',
      startLine: 10,
      endLine: 25,
      docstring: 'Logs in a user with credentials',
    });
    const retriever = new GraphRetriever(graph);

    const ctxWithRetriever: ToolContext = {
      ...context,
      retriever,
    };

    const retResp = await executor.execute(
      {
        toolName: 'retrieve_context',
        args: { query: 'loginUser', hops: 2 },
      },
      ctxWithRetriever,
    );

    expect(retResp.result.status).toBe('ok');
    expect(retResp.result.output).toContain('loginUser');
    expect(retResp.result.output).toContain('src/auth.ts:10-25');
  });

  it('enforces execution timeout', async () => {
    const timeoutExecutor = new ToolExecutor(registry, 100);

    const slowResp = await timeoutExecutor.execute(
      {
        toolName: 'run_command',
        args: { cmd: 'sleep 1' },
      },
      context,
      100, // 100ms timeout
    );

    expect(slowResp.result.status).toBe('error');
    expect(slowResp.result.error).toContain('timed out');
    expect(slowResp.spanAttributes.status).toBe('error');
  });
});
