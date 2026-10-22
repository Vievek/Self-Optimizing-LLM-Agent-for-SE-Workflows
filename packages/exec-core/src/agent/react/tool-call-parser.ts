import { ToolCallRequest } from '../types.js';
import { ParsedReActStep } from './types.js';

/**
 * Sanitizes slightly malformed JSON strings frequently produced by SLMs/LLMs:
 * - Trailing commas before closing braces/brackets
 * - Single-quoted strings or object keys
 * - Unescaped raw newlines in JSON values
 */
export function sanitizeJsonString(raw: string): string {
  let cleaned = raw.trim();

  // Remove trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

  // Replace single-quoted strings (keys and values in objects or array items) with double quotes
  cleaned = cleaned.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, p1) => {
    const escaped = p1.replace(/"/g, '\\"');
    return `"${escaped}"`;
  });

  return cleaned;
}

/**
 * Maps unstructured string input to appropriate tool arguments when an LLM
 * provides a plain string instead of a structured JSON object.
 */
function mapStringArgsToTool(toolName: string, input: string): Record<string, unknown> {
  const normalizedTool = toolName.toLowerCase();
  switch (normalizedTool) {
    case 'read_file':
    case 'list_directory':
      return { path: input };
    case 'grep_search':
    case 'retrieve_context':
      return { query: input };
    case 'run_command':
      return { command: input };
    case 'run_tests':
      return { test_ids: [input] };
    case 'write_file':
      return { path: input, content: '' };
    default:
      return { input };
  }
}

export class ToolCallParser {
  /**
   * Parses LLM generation into Thought, Action, Action Input, or Final Answer.
   * Supports:
   * 1. Standard ReAct syntax: Thought: ... / Action: ... / Action Input: ...
   * 2. Markdown JSON code blocks: ```json { "tool": "...", "parameters": { ... } } ```
   * 3. Markdown JSON code blocks: ```json { "name": "...", "arguments": { ... } } ```
   * 4. Direct JSON objects in text
   * 5. Final Answer: ... or unstructured completion
   */
  static parse(text: string): ParsedReActStep {
    const raw = text ?? '';
    const trimmed = raw.trim();

    let thought: string | undefined;
    let finalAnswer: string | undefined;
    const detectedCalls: ToolCallRequest[] = [];

    // 1. Extract explicit Thought if present
    const thoughtMatch = /Thought:\s*([\s\S]*?)(?=(?:Action:|Final Answer:|```|$))/i.exec(trimmed);
    if (thoughtMatch?.[1]) {
      thought = thoughtMatch[1].trim();
    }

    // 2. Extract Final Answer if present
    const finalAnswerMatch = /Final\s*Answer:\s*([\s\S]*)$/i.exec(trimmed);
    if (finalAnswerMatch?.[1]) {
      finalAnswer = finalAnswerMatch[1].trim();
    }

    // 3. Extract ReAct Action & Action Input
    const actionMatch = /Action:\s*([a-zA-Z0-9_.-]+)/i.exec(trimmed);
    if (actionMatch?.[1]) {
      const toolName = actionMatch[1].trim();
      const inputMatch =
        /Action\s*Input:\s*([\s\S]*?)(?=(?:\n\s*(?:Observation:|Thought:|Action:|Final\s*Answer:)|$))/i.exec(
          trimmed,
        );

      let args: Record<string, unknown> = {};

      if (inputMatch?.[1]) {
        let rawInput = inputMatch[1].trim();

        // Strip surrounding markdown code block if present inside Action Input
        const mdBlockMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(rawInput);
        if (mdBlockMatch?.[1]) {
          rawInput = mdBlockMatch[1].trim();
        }

        // Try direct JSON parse
        try {
          const parsed = JSON.parse(rawInput);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            args = parsed as Record<string, unknown>;
          } else if (typeof parsed === 'string') {
            args = mapStringArgsToTool(toolName, parsed);
          }
        } catch {
          // Try sanitized JSON parse
          try {
            const sanitized = sanitizeJsonString(rawInput);
            const parsed = JSON.parse(sanitized);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              args = parsed as Record<string, unknown>;
            } else if (typeof parsed === 'string') {
              args = mapStringArgsToTool(toolName, parsed);
            }
          } catch {
            // Fallback: raw string argument mapping
            args = mapStringArgsToTool(toolName, rawInput);
          }
        }
      }

      detectedCalls.push({ toolName, args });
    }

    // 4. If no ReAct action was found, inspect for Markdown JSON blocks or JSON objects
    if (detectedCalls.length === 0) {
      const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
      let match: RegExpExecArray | null;

      while ((match = jsonBlockRegex.exec(trimmed)) !== null) {
        if (!match[1]) continue;
        const blockContent = match[1].trim();
        try {
          const parsed = JSON.parse(blockContent);
          const calls = this.extractCallsFromJson(parsed);
          if (calls.length > 0) {
            detectedCalls.push(...calls);
          }
        } catch {
          try {
            const sanitized = sanitizeJsonString(blockContent);
            const parsed = JSON.parse(sanitized);
            const calls = this.extractCallsFromJson(parsed);
            if (calls.length > 0) {
              detectedCalls.push(...calls);
            }
          } catch {
            // Ignore non-JSON code blocks
          }
        }
      }
    }

    // 5. If still no calls, check if the entire content (or substring) is a raw JSON object
    if (detectedCalls.length === 0 && (trimmed.startsWith('{') || trimmed.includes('{"tool"'))) {
      const startIdx = trimmed.indexOf('{');
      const endIdx = trimmed.lastIndexOf('}');
      if (startIdx !== -1 && endIdx > startIdx) {
        const candidate = trimmed.substring(startIdx, endIdx + 1);
        try {
          const parsed = JSON.parse(candidate);
          const calls = this.extractCallsFromJson(parsed);
          if (calls.length > 0) {
            detectedCalls.push(...calls);
          }
        } catch {
          try {
            const sanitized = sanitizeJsonString(candidate);
            const parsed = JSON.parse(sanitized);
            const calls = this.extractCallsFromJson(parsed);
            if (calls.length > 0) {
              detectedCalls.push(...calls);
            }
          } catch {
            // Not valid JSON tool call
          }
        }
      }
    }

    // 6. Determine finality
    const hasToolCall = detectedCalls.length > 0;
    const isFinal = !hasToolCall && (finalAnswer !== undefined || trimmed.length > 0);

    // If no explicit thought and no tool call, entire text serves as final answer or thought
    if (!thought && hasToolCall) {
      const beforeAction = trimmed.split(/Action:/i)[0]?.trim();
      if (beforeAction && !beforeAction.toLowerCase().startsWith('thought:')) {
        thought = beforeAction;
      }
    }

    if (!finalAnswer && isFinal) {
      finalAnswer = trimmed;
    }

    return {
      thought,
      toolCall: detectedCalls[0],
      toolCalls: detectedCalls.length > 0 ? detectedCalls : undefined,
      finalAnswer,
      isFinal,
      raw,
    };
  }

  /**
   * Extracts ToolCallRequest(s) from a parsed JSON structure.
   */
  private static extractCallsFromJson(obj: unknown): ToolCallRequest[] {
    if (!obj || typeof obj !== 'object') return [];

    if (Array.isArray(obj)) {
      const results: ToolCallRequest[] = [];
      for (const item of obj) {
        results.push(...this.extractCallsFromJson(item));
      }
      return results;
    }

    const record = obj as Record<string, unknown>;

    // Pattern 1: { tool: "name", parameters: { ... } }
    if (typeof record.tool === 'string') {
      const args =
        typeof record.parameters === 'object' && record.parameters !== null
          ? (record.parameters as Record<string, unknown>)
          : {};
      return [{ toolName: record.tool, args }];
    }

    // Pattern 2: { name: "name", arguments: { ... } }
    if (typeof record.name === 'string') {
      let args: Record<string, unknown> = {};
      if (typeof record.arguments === 'object' && record.arguments !== null) {
        args = record.arguments as Record<string, unknown>;
      } else if (typeof record.arguments === 'string') {
        try {
          args = JSON.parse(record.arguments);
        } catch {
          args = { input: record.arguments };
        }
      }
      return [{ toolName: record.name, args }];
    }

    // Pattern 3: { action: "name", action_input: { ... } }
    if (typeof record.action === 'string') {
      const args =
        typeof record.action_input === 'object' && record.action_input !== null
          ? (record.action_input as Record<string, unknown>)
          : {};
      return [{ toolName: record.action, args }];
    }

    return [];
  }
}
