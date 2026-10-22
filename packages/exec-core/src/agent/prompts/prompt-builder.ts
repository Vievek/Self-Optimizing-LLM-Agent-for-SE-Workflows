import { AgentTask, SubTask } from '../types.js';
import { formatToolsForReActPrompt } from './tool-schema-bridge.js';

export interface PromptBuilderOptions {
  systemPromptVersion?: string;
  customGuidelines?: string[];
}

export class PromptBuilder {
  private readonly systemPromptVersion: string;
  private readonly customGuidelines: string[];

  constructor(options: PromptBuilderOptions = {}) {
    this.systemPromptVersion = options.systemPromptVersion ?? 'v1.0';
    this.customGuidelines = options.customGuidelines ?? [];
  }

  /**
   * Generates the system prompt instructing the agent on role, tools, and ReAct protocol.
   */
  buildSystemPrompt(): string {
    const toolManual = formatToolsForReActPrompt();

    return `You are an expert autonomous Software Engineering Agent specialized in solving complex repository issues, debugging, and implementing software changes.

## Protocol: ReAct (Reasoning and Acting)
For every turn, you must think carefully before taking an action:
1. **Thought**: Analyze the problem, your current progress, and decide what action to take next.
2. **Action**: Choose ONE available tool to call.
3. **Action Input**: Provide the valid JSON arguments for that tool.

When you have completely finished the subtask goal:
1. **Thought**: Explain why the subtask goal has been fully satisfied.
2. **Final Answer**: Provide a concise summary of the outcome.

${toolManual}

## Critical Operational Rules
1. Never guess file contents or function signatures. Always use \`read_file\`, \`retrieve_context\`, or \`grep_search\` first.
2. When editing code with \`edit_file\`, provide exact existing lines as \`old_str\` so the replacement is surgical and unique.
3. If an edit fails or tests fail, analyze the error output in the next turn and adjust your approach.
4. Keep actions focused strictly on the active subtask goal.
${this.customGuidelines.map((g) => `5. ${g}`).join('\n')}`;
  }

  /**
   * Formats the user instruction prompt for an active subtask.
   */
  buildSubtaskPrompt(task: AgentTask, subtask: SubTask, previousContext?: string): string {
    const sections: string[] = [
      `# Task Overview`,
      `Repository: ${task.repo}`,
      `Problem Statement:\n${task.problemStatement}\n`,
      `# Active Subtask [Step ${subtask.stepIndex + 1}]`,
      `Type: ${subtask.type}`,
      `Goal: ${subtask.goal}`,
    ];

    if (subtask.targetFiles && subtask.targetFiles.length > 0) {
      sections.push(`Target Files: ${subtask.targetFiles.join(', ')}`);
    }

    if (subtask.lastError) {
      sections.push(
        `\n⚠️ Previous Attempt Failed with Error:\n${subtask.lastError}\nPlease analyze this failure and take corrective action.`,
      );
    }

    if (previousContext) {
      sections.push(`\n# Relevant Context & Discoveries\n${previousContext}`);
    }

    sections.push(
      `\nPlease begin by outputting your initial Thought and the first Action to execute.`,
    );

    return sections.join('\n');
  }
}

