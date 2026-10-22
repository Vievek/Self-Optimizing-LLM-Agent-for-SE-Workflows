import { TOOL_DEFINITIONS } from '../tools/tool-definitions.js';

export interface OpenAiFunctionDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Formats our standard ACI tool definitions into the standard OpenAI Function Calling schema
 * accepted by OpenAI, Google Gemini (via OpenAI-compat endpoint), and Qwen2.5-Coder.
 */
export function formatToolsForOpenAi(
  toolNames?: Array<keyof typeof TOOL_DEFINITIONS>,
): OpenAiFunctionDefinition[] {
  const selectedKeys =
    toolNames ?? (Object.keys(TOOL_DEFINITIONS) as Array<keyof typeof TOOL_DEFINITIONS>);

  return selectedKeys.map((key) => {
    const def = TOOL_DEFINITIONS[key];
    return {
      type: 'function',
      function: {
        name: def.name,
        description: def.description,
        parameters: def.parameters,
      },
    };
  });
}

/**
 * Formats tool definitions into a clear textual manual for models without native
 * function calling or for inclusion in ReAct system prompts.
 */
export function formatToolsForReActPrompt(
  toolNames?: Array<keyof typeof TOOL_DEFINITIONS>,
): string {
  const selectedKeys =
    toolNames ?? (Object.keys(TOOL_DEFINITIONS) as Array<keyof typeof TOOL_DEFINITIONS>);

  const lines: string[] = ['You have access to the following workspace tools:\n'];

  for (const key of selectedKeys) {
    const def = TOOL_DEFINITIONS[key];
    const paramsObj = def.parameters as {
      properties?: Record<string, { type: string; description: string }>;
      required?: readonly string[];
    };
    const props = (paramsObj.properties || {}) as Record<
      string,
      { type: string; description: string }
    >;
    const req = (paramsObj.required || []) as readonly string[];

    const paramEntries = Object.entries(props).map(([pName, pInfo]) => {
      const isReq = req.includes(pName) ? 'required' : 'optional';
      return `    - ${pName} (${pInfo.type}, ${isReq}): ${pInfo.description}`;
    });

    lines.push(`- **${def.name}**: ${def.description}`);
    lines.push(`  Parameters:`);
    lines.push(...paramEntries);
    lines.push('');
  }

  return lines.join('\n');
}
