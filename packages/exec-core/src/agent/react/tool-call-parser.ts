import { ToolCallRequest } from '../types.js';
import { ParsedReActStep } from './types.js';

/**
 * Escapes unescaped raw newlines and tabs occurring inside double-quoted JSON strings.
 */
export function fixRawNewlinesInJson(str: string): string {
  let inString = false;
  let escaped = false;
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escaped) {
      escaped = false;
      out += ch;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      out += ch;
    } else if (ch === '"') {
      inString = !inString;
      out += ch;
    } else if (inString && (ch === '\n' || ch === '\r')) {
      out += ch === '\n' ? '\\n' : '';
    } else if (inString && ch === '\t') {
      out += '\\t';
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Recovers truncated JSON payloads frequently produced when models hit output token limits:
 * - Extracts fully completed files from a truncated "files": [ ... ] array
 * - Extracts completed paths from a truncated "paths": [ ... ] array
 * - Closes truncated single-object payloads if feasible
 */
export function repairTruncatedJson(raw: string): Record<string, unknown> | null {
  // 1. Repair truncated "files": [...] array
  const filesIdx = raw.indexOf('"files"');
  if (filesIdx !== -1) {
    const bracketIdx = raw.indexOf('[', filesIdx);
    if (bracketIdx !== -1) {
      const afterBracket = raw.substring(bracketIdx + 1);
      let lastCloseBrace = afterBracket.lastIndexOf('}');
      while (lastCloseBrace !== -1) {
        const validSlice = afterBracket.substring(0, lastCloseBrace + 1);
        const reconstructed = `{"files": [${validSlice}]}`;
        try {
          const sanitized = sanitizeJsonString(reconstructed);
          const parsed = JSON.parse(sanitized);
          if (Array.isArray(parsed.files) && parsed.files.length > 0) {
            return { files: parsed.files, truncated: true };
          }
        } catch {
          // Keep searching backwards for previous valid file item
        }
        lastCloseBrace = afterBracket.lastIndexOf('}', lastCloseBrace - 1);
      }
    }
  }

  // 2. Repair truncated "paths": [...] array
  const pathsIdx = raw.indexOf('"paths"');
  if (pathsIdx !== -1) {
    const bracketIdx = raw.indexOf('[', pathsIdx);
    if (bracketIdx !== -1) {
      const afterBracket = raw.substring(bracketIdx + 1);
      let lastQuote = afterBracket.lastIndexOf('"');
      while (lastQuote !== -1) {
        const validSlice = afterBracket.substring(0, lastQuote + 1);
        const reconstructed = `{"paths": [${validSlice}]}`;
        try {
          const sanitized = sanitizeJsonString(reconstructed);
          const parsed = JSON.parse(sanitized);
          if (Array.isArray(parsed.paths) && parsed.paths.length > 0) {
            return { paths: parsed.paths, truncated: true };
          }
        } catch {
          // Search backwards
        }
        lastQuote = afterBracket.lastIndexOf('"', lastQuote - 1);
      }
    }
  }

  // 3. Repair unclosed single JSON object (e.g. missing trailing quotes or braces)
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    const variations = [
      trimmed + '"}',
      trimmed + '"} }',
      trimmed + '}',
      trimmed + '"]}',
      trimmed + '"] }',
    ];
    for (const v of variations) {
      try {
        const sanitized = sanitizeJsonString(v);
        const parsed = JSON.parse(sanitized);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return { ...(parsed as Record<string, unknown>), truncated: true };
        }
      } catch {
        // Continue
      }
    }
  }

  return null;
}

/**
 * Sanitizes slightly malformed JSON strings frequently produced by SLMs/LLMs:
 * - Unescaped raw newlines/tabs inside strings
 * - Trailing commas before closing braces/brackets
 * - Single-quoted strings or object keys
 */
export function sanitizeJsonString(raw: string): string {
  let cleaned = raw.trim();

  // Escape unescaped newlines/tabs inside double-quoted string literals
  cleaned = fixRawNewlinesInJson(cleaned);

  // Remove trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

  // Replace single-quoted strings (keys and values in objects or array items) with double quotes
  cleaned = cleaned.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, p1) => {
    const escaped = p1.replace(/"/g, '\\"');
    return `"${escaped}"`;
  });

  return cleaned;
}

const KNOWN_TOOLS = [
  'read_file',
  'write_file',
  'edit_file',
  'run_command',
  'list_directory',
  'grep_search',
  'retrieve_context',
  'run_tests',
];

export function resolveToolName(candidate: string): string {
  const lower = candidate.toLowerCase().trim();
  if (lower.startsWith('<') || lower.includes('tool_call')) {
    return '';
  }

  // Direct match
  const exact = KNOWN_TOOLS.find((t) => t === lower);
  if (exact) return exact;

  // Contains known tool name
  const contained = KNOWN_TOOLS.find((t) => lower.includes(t));
  if (contained) return contained;

  // Verb heuristics
  if (lower.startsWith('read') || lower.includes('read file')) return 'read_file';
  if (lower.startsWith('write') || lower.includes('write file')) return 'write_file';
  if (lower.startsWith('edit') || lower.includes('edit file')) return 'edit_file';
  if (lower.startsWith('list') || lower.includes('directory') || lower.includes('dir'))
    return 'list_directory';
  if (lower.startsWith('grep') || lower.includes('search')) return 'grep_search';
  if (lower.startsWith('test') || lower.includes('run test')) return 'run_tests';
  if (
    lower.startsWith('run') ||
    lower.startsWith('call') ||
    lower.startsWith('exec') ||
    lower.startsWith('cmd')
  )
    return 'run_command';

  return candidate;
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
      if (input.trim().startsWith('{') || input.includes('"files"') || input.includes('"path"')) {
        return {
          error:
            'Action Input for write_file was truncated mid-generation due to token limits. Please write 1 file at a time using { "path": "...", "content": "..." } so your response fits inside the token budget.',
          rawInput: input,
        };
      }
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
    const thoughtMatch =
      /(?:\*{1,2}|#+\s*)?Thought(?:\*{1,2})?:?\s*([\s\S]*?)(?=(?:\n\s*(?:\*{1,2}|#+\s*)?(?:Action|Final\s*Answer)(?:\*{1,2})?:?|```|$))/i.exec(
        trimmed,
      );
    if (thoughtMatch?.[1]) {
      thought = thoughtMatch[1].trim();
    }

    // 2. Extract Final Answer if present
    const finalAnswerMatch = /(?:\*{1,2}|#+\s*)?Final\s*Answer(?:\*{1,2})?:?\s*([\s\S]*)$/i.exec(
      trimmed,
    );
    if (finalAnswerMatch?.[1]) {
      finalAnswer = finalAnswerMatch[1].trim();
    }

    // Helper to parse Action Input payload
    const parseActionInputPayload = (
      tName: string,
      rawInput: string,
      initialArgs: Record<string, unknown> = {},
    ): Record<string, unknown> => {
      let args: Record<string, unknown> = { ...initialArgs };
      let cleaned = rawInput.trim();

      const codeBlockMatch = /^```(?:json)?\s*([\s\S]*?)\s*```/i.exec(cleaned);
      if (codeBlockMatch?.[1]) {
        cleaned = codeBlockMatch[1].trim();
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
        cleaned = cleaned.replace(/\s*```[\s\S]*$/i, '');
        cleaned = cleaned.trim();
      }

      // If payload starts with { or [ and has unclosed narrative prose appended after closing brace/bracket, slice balanced JSON
      if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
        const isObject = cleaned.startsWith('{');
        const openChar = isObject ? '{' : '[';
        const closeChar = isObject ? '}' : ']';
        let depth = 0;
        let inString = false;
        let escape = false;
        let balancedIndex = -1;

        for (let i = 0; i < cleaned.length; i++) {
          const ch = cleaned[i];
          if (escape) {
            escape = false;
            continue;
          }
          if (ch === '\\' && inString) {
            escape = true;
            continue;
          }
          if (ch === '"') {
            inString = !inString;
            continue;
          }
          if (!inString) {
            if (ch === openChar) depth++;
            else if (ch === closeChar) {
              depth--;
              if (depth === 0) {
                balancedIndex = i;
                break;
              }
            }
          }
        }
        if (balancedIndex !== -1 && balancedIndex < cleaned.length - 1) {
          cleaned = cleaned.substring(0, balancedIndex + 1).trim();
        }
      }

      try {
        const parsed = JSON.parse(cleaned);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          args = { ...args, ...parsed };
        } else if (Array.isArray(parsed)) {
          if (tName === 'edit_file') args = { edits: parsed };
          else if (tName === 'write_file') args = { files: parsed };
          else if (tName === 'read_file') args = { paths: parsed };
        } else if (typeof parsed === 'string') {
          args = mapStringArgsToTool(tName, parsed);
        }
      } catch {
        try {
          const sanitized = sanitizeJsonString(cleaned);
          const parsed = JSON.parse(sanitized);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            args = { ...args, ...parsed };
          } else if (Array.isArray(parsed)) {
            if (tName === 'edit_file') args = { edits: parsed };
            else if (tName === 'write_file') args = { files: parsed };
            else if (tName === 'read_file') args = { paths: parsed };
          } else if (typeof parsed === 'string') {
            args = mapStringArgsToTool(tName, parsed);
          }
        } catch {
          const repaired = repairTruncatedJson(cleaned);
          if (repaired) {
            args = { ...args, ...repaired };
          } else {
            args = mapStringArgsToTool(tName, cleaned);
          }
        }
      }

      // If args has 'input' and it contains stringified JSON, unwrap it
      if (
        typeof args.input === 'string' &&
        (args.input.includes('{') || args.input.includes('"path"'))
      ) {
        const innerJsonMatch = /\{[\s\S]*?\}/.exec(args.input);
        if (innerJsonMatch?.[0]) {
          try {
            const innerParsed = JSON.parse(sanitizeJsonString(innerJsonMatch[0]));
            if (
              typeof innerParsed === 'object' &&
              innerParsed !== null &&
              !Array.isArray(innerParsed)
            ) {
              delete args.input;
              args = { ...args, ...innerParsed };
            }
          } catch {
            // ignore unpack error
          }
        }
      }

      return args;
    };

    // 3. Extract ReAct Action & Action Input (supports single or multiple consecutive Actions in one turn)
    const actionBlockRegex =
      /(?:\*{1,2}|#+\s*)?Action(?:\*{1,2})?(?::[^\S\r\n]*|\s*\n\s*)([a-zA-Z_][a-zA-Z0-9_-]*|`{3}(?:json)?[\s\S]*?`{3}|\{[\s\S]*?\})/gi;
    let actMatch: RegExpExecArray | null;
    const actionMatches: Array<{
      index: number;
      toolName: string;
      embeddedArgs?: Record<string, unknown>;
    }> = [];

    while ((actMatch = actionBlockRegex.exec(trimmed)) !== null) {
      const rawCaptured = actMatch[1]?.trim() || '';
      let matchedTool = '';
      let embeddedArgs: Record<string, unknown> | undefined;

      if (rawCaptured.startsWith('{') || rawCaptured.startsWith('```')) {
        try {
          const rawJson = rawCaptured
            .replace(/^`{3}(?:json)?\s*/i, '')
            .replace(/\s*`{3}$/, '')
            .trim();
          const obj = JSON.parse(rawJson);
          if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
            const rawName = String(obj.action || obj.tool || obj.name || '');
            matchedTool = resolveToolName(rawName);
            const copy = { ...obj };
            delete copy.action;
            delete copy.tool;
            delete copy.name;
            embeddedArgs = copy;
          }
        } catch {
          // ignore JSON parse failure
        }
      }

      if (!matchedTool) {
        matchedTool = resolveToolName(rawCaptured);
      }

      if (matchedTool && !matchedTool.startsWith('<')) {
        actionMatches.push({
          index: actMatch.index,
          toolName: matchedTool,
          embeddedArgs,
        });
      }
    }

    if (actionMatches.length > 0) {
      for (let i = 0; i < actionMatches.length; i++) {
        const current = actionMatches[i]!;
        const nextStart =
          i + 1 < actionMatches.length ? actionMatches[i + 1]!.index : trimmed.length;
        const actionSegment = trimmed.substring(current.index, nextStart);

        const inputMatch =
          /(?:\*{1,2}|#+\s*)?Action\s*Input(?:\*{1,2})?(?::|\s*\n)\s*([\s\S]*?)(?=(?:\n\s*(?:\*{1,2}|#+\s*)?(?:Observation|Thought|Action|Final\s*Answer):?|$))/i.exec(
            actionSegment,
          );

        let finalArgs: Record<string, unknown> = current.embeddedArgs
          ? { ...current.embeddedArgs }
          : {};

        if (inputMatch?.[1]) {
          finalArgs = parseActionInputPayload(current.toolName, inputMatch[1], finalArgs);
        } else if (current.toolName === 'list_directory') {
          finalArgs = { path: '.' };
        }

        detectedCalls.push({ toolName: current.toolName, args: finalArgs });
      }
    }

    // 3.5. Extract Qwen-style XML tool calls: <tool_call> ... </tool_call>
    if (detectedCalls.length === 0 && trimmed.includes('<tool_call>')) {
      const toolCallRegex = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/gi;
      let tcMatch: RegExpExecArray | null;
      while ((tcMatch = toolCallRegex.exec(trimmed)) !== null) {
        const inner = tcMatch[1]?.trim();
        if (!inner) continue;

        // 3.5.1 Check if inner content is JSON: {"name": "...", "arguments": {...}}
        if (inner.startsWith('{') && inner.endsWith('}')) {
          try {
            const parsed = JSON.parse(inner);
            const calls = this.extractCallsFromJson(parsed);
            if (calls.length > 0) {
              detectedCalls.push(...calls);
              continue;
            }
          } catch {
            // Ignore
          }
        }

        // 3.5.2 Extract tool name from XML tag or plain line
        const fnMatch = /<(?:function=)?([a-zA-Z0-9_.-]+)>/i.exec(inner);
        const plainNameMatch = /^([a-zA-Z0-9_.-]+)/i.exec(inner);
        const rawToolName = fnMatch?.[1] ?? plainNameMatch?.[1];

        if (rawToolName) {
          const toolName = resolveToolName(rawToolName);
          let args: Record<string, unknown> = {};

          // Check for JSON block in inner: {...}
          const jsonMatch = /\{[\s\S]*?\}/.exec(inner);
          if (jsonMatch?.[0]) {
            try {
              const parsed = JSON.parse(sanitizeJsonString(jsonMatch[0]));
              if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                args = parsed as Record<string, unknown>;
              }
            } catch {
              // Ignore
            }
          }

          // Check for <parameter=key>value</parameter>
          const paramRegex = /<parameter=([a-zA-Z0-9_.-]+)>([\s\S]*?)<\/parameter>/gi;
          let pMatch: RegExpExecArray | null;
          while ((pMatch = paramRegex.exec(inner)) !== null) {
            const pName = pMatch[1]?.trim();
            const pVal = pMatch[2]?.trim();
            if (pName && pVal !== undefined) {
              if (
                pName === 'content' ||
                pName === 'cmd' ||
                pName === 'command' ||
                pName === 'path' ||
                pName === 'paths' ||
                pName === 'query' ||
                pName === 'old_str' ||
                pName === 'new_str'
              ) {
                args[pName] = pVal;
              } else {
                try {
                  args[pName] = JSON.parse(pVal);
                } catch {
                  args[pName] = pVal;
                }
              }
            }
          }

          if (Object.keys(args).length === 0 && toolName === 'list_directory') {
            args = { path: '.' };
          }

          detectedCalls.push({ toolName, args });
        }
      }
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
      const beforeAction = trimmed.split(/(?:\*{1,2}|#+\s*)?Action(?:\*{1,2})?:/i)[0]?.trim();
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
