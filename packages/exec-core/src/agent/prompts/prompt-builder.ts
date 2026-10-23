import { AgentTask, SubTask } from '../types.js';
import { formatToolsForReActPrompt } from './tool-schema-bridge.js';

export interface PromptBuilderOptions {
  systemPromptVersion?: string;
  customGuidelines?: string[];
  maxBatchWriteFiles?: number;
  maxBatchReadFiles?: number;
}

export class PromptBuilder {
  private readonly systemPromptVersion: string;
  private readonly customGuidelines: string[];
  private readonly maxBatchWriteFiles: number;
  private readonly maxBatchReadFiles: number;

  constructor(options: PromptBuilderOptions = {}) {
    this.systemPromptVersion = options.systemPromptVersion ?? 'v1.0';
    this.customGuidelines = options.customGuidelines ?? [];
    this.maxBatchWriteFiles = options.maxBatchWriteFiles ?? 3;
    this.maxBatchReadFiles = options.maxBatchReadFiles ?? 8;
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
1. For existing codebases, never guess file contents or function signatures. Use \`retrieve_context\` (AST search) or \`read_file\` to inspect relevant code.
2. For project creation or scaffolding tasks, inspect the directory with \`list_directory\` first (which recursively lists directories up to depth 4 by default). Do NOT query subdirectories individually. Do NOT read every existing file if you already see the structure. Immediately proceed to write the missing files with \`write_file\`.
3. You can write multiple files at once in a single turn using \`write_file\` with \`{ "files": [{ "path": "...", "content": "..." }, { "path": "...", "content": "..." }] }\`. Limit each batch to up to ${this.maxBatchWriteFiles} files to stay within output token limits and prevent truncation.
4. When reading multiple files at once, use \`read_file\` with \`{ "paths": ["file1", "file2"] }\` (up to ${this.maxBatchReadFiles} files per call).
5. Always provide \`Action Input:\` with valid JSON arguments whenever you specify an \`Action:\`. Example:
   **Action**: list_directory
   **Action Input**: { "path": "." }
6. Complete exploration efficiently (within 1-2 tool calls). Conclude promptly with **Thought** and **Final Answer**.
${this.customGuidelines.map((g, idx) => `${7 + idx}. ${g}`).join('\n')}`;
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

      if (
        (subtask.type === 'edit_multi_file' || subtask.type === 'edit_single_file') &&
        previousContext.toLowerCase().includes('explore')
      ) {
        sections.push(
          `\n🚨 CRITICAL OPERATIONAL DIRECTIVE:\nRepository exploration has ALREADY been completed in Step 1. DO NOT call list_directory. Use the file layout documented above in "Relevant Context & Discoveries" and begin IMMEDIATELY by calling write_file to create the missing files.`,
        );
      }
    }

    sections.push(
      `\nPlease begin by outputting your initial Thought and the first Action to execute.`,
    );

    return sections.join('\n');
  }
}
