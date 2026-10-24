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
2. For project creation or scaffolding tasks, inspect the directory with \`list_directory\` first (which recursively lists directories up to depth 4 by default). Do NOT query subdirectories individually. Do NOT read every existing file if you already see the structure. Immediately proceed to write the missing files with \`write_file\`. NEVER rewrite files that have already been created.
3. You can write files using \`write_file\` with \`{ "path": "...", "content": "..." }\` or batch write with \`{ "files": [{ "path": "...", "content": "..." }] }\`. ${
      this.maxBatchWriteFiles <= 2
        ? 'IMPORTANT: Write 1 file at a time (or at most 2 small files) using write_file so the entire code fits completely within output token limits without getting truncated.'
        : `Limit each batch to up to ${this.maxBatchWriteFiles} files to complete scaffolding in fewer round-trips.`
    }
4. When reading multiple files at once, use \`read_file\` with \`{ "paths": ["file1", "file2"] }\` (up to ${this.maxBatchReadFiles} files per call).
5. Always provide \`Action Input:\` with valid JSON arguments whenever you specify an \`Action:\`. Example:
   **Action**: list_directory
   **Action Input**: { "path": "." }
6. Complete exploration efficiently (within 1-2 tool calls). Conclude promptly with **Thought** and **Final Answer**.
7. When removing obsolete, conflicting, or duplicate files, call \`delete_file\` with \`{ "path": "path/to/file" }\`.
${this.customGuidelines.map((g, idx) => `${8 + idx}. ${g}`).join('\n')}`;
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

    if (subtask.contract) {
      sections.push(`\n# ARCHITECTURAL CONTRACT (IMMUTABLE SCHEMA)\n${subtask.contract}`);
    }

    if (previousContext) {
      sections.push(`\n# Relevant Context & Discoveries\n${previousContext}`);
    }

    if (subtask.id.includes('explain') || subtask.goal.toLowerCase().includes('explain')) {
      sections.push(
        `\n📖 EXPLANATION-ONLY DIRECTIVE:\nThis is a read-only investigation. Your goal is to inspect the codebase using retrieve_context (AST graph) and read_file, analyze the code, and synthesize a clear, comprehensive explanation with code snippets or architecture flows directly in your Final Answer. Do NOT call write_file, edit_file, or delete_file.`,
      );
    } else if (subtask.type === 'explore') {
      sections.push(
        `\n🔍 RECONNAISSANCE DIRECTIVE:\nYour only goal in this step is to inspect the workspace layout with list_directory (once) and identify what exists and what is missing in your Final Answer. Do NOT call write_file, edit_file, or read_file in this recon step. Conclude promptly.`,
      );
    } else if (subtask.type === 'localize') {
      sections.push(
        `\n🔎 AST-FIRST LOCALIZATION DIRECTIVE:\n1. First call retrieve_context with the symbol, function, or keyword to pinpoint callers, definitions, and line numbers via the AST Code Graph.\n2. If exact lines are needed for precision patching, follow up with a targeted read_file.\n3. Then conclude with **Thought** and **Final Answer** detailing the required modification. Do NOT edit files in this step.`,
      );
    } else if (subtask.type === 'edit_multi_file' || subtask.type === 'edit_single_file') {
      if (subtask.id.includes('scaffold')) {
        sections.push(
          `\n🚨 IMPLEMENTATION & SCOPE DIRECTIVE:\n1. Repository exploration has already been completed. DO NOT call list_directory or re-explore. Your very first action MUST be write_file to begin creating the project files.\n2. STRICT SCOPE BOUNDARY: Strictly conform to the ARCHITECTURAL CONTRACT above. Only create the files for this specific phase. Do NOT invent extra auxiliary components, edit forms, or sub-pages. Conclude IMMEDIATELY with **Thought** and **Final Answer** once the required files are written.`,
        );
      } else {
        sections.push(
          `\n⚡ FAST SURGICAL PATCH DIRECTIVE:\nThe target file content and line numbers were already localized and confirmed in the previous step.\n1. Your very first action MUST be edit_file with precision matching (or write_file if creating missing config, or delete_file if removing obsolete conflicting files). Do NOT call read_file or list_directory first.\n2. As soon as the edit/write returns ok, DO NOT call read_file to re-inspect the change. Conclude IMMEDIATELY with **Thought** and **Final Answer**.`,
        );
      }
    } else if (subtask.id.includes('verify') || subtask.goal.toLowerCase().includes('verify')) {
      sections.push(
        `\n✅ VERIFICATION DIRECTIVE:\nInspect the directory structure once with list_directory to verify that all created project files exist. Then IMMEDIATELY conclude with **Thought** and **Final Answer** summarizing the verified files. Do NOT edit or rewrite files.`,
      );
    }

    sections.push(
      `\nPlease begin by outputting your initial Thought and the first Action to execute.`,
    );

    return sections.join('\n');
  }
}
