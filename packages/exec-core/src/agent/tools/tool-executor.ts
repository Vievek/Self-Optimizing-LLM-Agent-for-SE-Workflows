import { ToolCallSpanAttributesSchema } from '@soa/contracts';
import { ToolCallRequest, ToolResult, ToolContext, ToolCallSpanAttributes } from '../types.js';
import { ToolRegistry } from './tool-registry.js';

export interface ToolExecutionResponse {
  result: ToolResult;
  spanAttributes: ToolCallSpanAttributes;
}

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly defaultTimeoutMs: number = 60000,
  ) {}

  /**
   * Executes an inbound tool call request within the sandbox runtime, enforcing
   * timeouts and generating telemetry-ready span attributes adhering to @soa/contracts.
   */
  async execute(
    request: ToolCallRequest,
    context: ToolContext,
    timeoutMs?: number,
  ): Promise<ToolExecutionResponse> {
    const startTime = performance.now();
    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;

    const handler = this.registry.get(request.toolName);
    if (!handler) {
      const latencyMs = Math.max(0, Math.round(performance.now() - startTime));
      const errorMsg = `Tool "${request.toolName}" is not registered in the tool registry. Available tools: ${this.registry.getNames().join(', ')}`;
      const result: ToolResult = {
        status: 'error',
        output: '',
        error: errorMsg,
        latencyMs,
      };

      const spanAttributes = ToolCallSpanAttributesSchema.parse({
        tool_name: request.toolName,
        args: request.args,
        status: 'error',
        error: errorMsg,
        latency_ms: latencyMs,
        retry_of: request.retryOf ?? null,
      });

      return { result, spanAttributes };
    }

    try {
      const executePromise = handler.execute(request.args, context);

      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Tool "${request.toolName}" timed out after ${effectiveTimeout}ms`));
        }, effectiveTimeout);
        // Ensure timer doesn't prevent Node from exiting if unref is available
        if (typeof timer.unref === 'function') {
          timer.unref();
        }
      });

      const rawResult = await Promise.race([executePromise, timeoutPromise]);
      const latencyMs = Math.max(0, Math.round(performance.now() - startTime));

      const result: ToolResult = {
        ...rawResult,
        latencyMs: rawResult.latencyMs > 0 ? rawResult.latencyMs : latencyMs,
      };

      const spanAttributes = ToolCallSpanAttributesSchema.parse({
        tool_name: request.toolName,
        args: request.args,
        status: result.status,
        error: result.error,
        latency_ms: latencyMs,
        retry_of: request.retryOf ?? null,
      });

      return { result, spanAttributes };
    } catch (err: unknown) {
      const latencyMs = Math.max(0, Math.round(performance.now() - startTime));
      const message = err instanceof Error ? err.message : String(err);

      const result: ToolResult = {
        status: 'error',
        output: '',
        error: message,
        latencyMs,
      };

      const spanAttributes = ToolCallSpanAttributesSchema.parse({
        tool_name: request.toolName,
        args: request.args,
        status: 'error',
        error: message,
        latency_ms: latencyMs,
        retry_of: request.retryOf ?? null,
      });

      return { result, spanAttributes };
    }
  }
}
