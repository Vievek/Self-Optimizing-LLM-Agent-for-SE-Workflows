import { ToolHandler, ToolContext, ToolResult } from '../../types.js';

export class RunCommandHandler implements ToolHandler {
  readonly name = 'run_command';
  readonly description = 'Execute a shell command inside the sandbox workspace';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const cmd = typeof args.cmd === 'string' ? args.cmd : '';
    const timeoutMs =
      typeof args.timeout_ms === 'number' && args.timeout_ms > 0 ? args.timeout_ms : 60000;

    if (!cmd.trim()) {
      return {
        status: 'error',
        output: '',
        error: 'Missing required argument "cmd"',
        latencyMs: 0,
      };
    }

    try {
      const execRes = await context.sandbox.exec(context.workspaceId, cmd, { timeoutMs });

      const outputParts: string[] = [];
      if (execRes.stdout) outputParts.push(execRes.stdout);
      if (execRes.stderr) outputParts.push(`[STDERR]\n${execRes.stderr}`);
      if (outputParts.length === 0) outputParts.push('(command produced no output)');

      const fullOutput = outputParts.join('\n');

      if (execRes.exitCode !== 0) {
        return {
          status: 'error',
          output: fullOutput,
          error: `Command exited with non-zero code: ${execRes.exitCode}`,
          latencyMs: execRes.durationMs,
          data: {
            exitCode: execRes.exitCode,
            durationMs: execRes.durationMs,
          },
        };
      }

      return {
        status: 'ok',
        output: fullOutput,
        error: null,
        latencyMs: execRes.durationMs,
        data: {
          exitCode: 0,
          durationMs: execRes.durationMs,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        output: '',
        error: `Command execution threw an unexpected error: ${message}`,
        latencyMs: 0,
      };
    }
  }
}
