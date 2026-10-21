import { ToolHandler, ToolContext, ToolResult } from '../../types.js';

export class RunTestsHandler implements ToolHandler {
  readonly name = 'run_tests';
  readonly description = 'Execute test suites in the workspace and parse results';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const testIds = Array.isArray(args.test_ids)
      ? (args.test_ids.filter((id) => typeof id === 'string') as string[])
      : [];
    const testCmd = typeof args.test_cmd === 'string' ? args.test_cmd.trim() : '';

    try {
      // If explicit test_ids provided or no custom test_cmd given, use sandbox.runTests
      if (testIds.length > 0 || !testCmd) {
        const testRes = await context.sandbox.runTests(context.workspaceId, testIds);
        const hasFailures = testRes.failed > 0 || testRes.errors > 0;

        const summary = `Tests finished: ${testRes.passed} passed, ${testRes.failed} failed, ${testRes.errors} errors.\n\nDetails:\n${testRes.details}`;

        return {
          status: hasFailures ? 'error' : 'ok',
          output: summary,
          error: hasFailures
            ? `Test suite reported ${testRes.failed} failures and ${testRes.errors} errors`
            : null,
          latencyMs: 0,
          data: testRes,
        };
      }

      // If custom test_cmd provided
      const execRes = await context.sandbox.exec(context.workspaceId, testCmd, {
        timeoutMs: 180000,
      });

      const output = `${execRes.stdout}\n${execRes.stderr}`.trim();
      const isFailed = execRes.exitCode !== 0;

      return {
        status: isFailed ? 'error' : 'ok',
        output: output || '(test command completed with empty output)',
        error: isFailed ? `Test command exited with code ${execRes.exitCode}` : null,
        latencyMs: execRes.durationMs,
        data: {
          exitCode: execRes.exitCode,
          durationMs: execRes.durationMs,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        output: '',
        error: `Failed to execute tests: ${message}`,
        latencyMs: 0,
      };
    }
  }
}
