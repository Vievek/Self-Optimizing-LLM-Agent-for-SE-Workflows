import { describe, it, expect } from 'vitest';
import { formatToolsForOpenAi, formatToolsForReActPrompt } from './tool-schema-bridge.js';
import { PromptBuilder } from './prompt-builder.js';
import { AgentTask, SubTask } from '../types.js';

describe('Tool Schema Bridge & Prompt Builder', () => {
  describe('formatToolsForOpenAi', () => {
    it('formats all 8 standard tools into OpenAI function calling format', () => {
      const openAiTools = formatToolsForOpenAi();

      expect(openAiTools.length).toBe(8);

      const toolNames = openAiTools.map((t) => t.function.name);
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('edit_file');
      expect(toolNames).toContain('run_command');
      expect(toolNames).toContain('run_tests');
      expect(toolNames).toContain('retrieve_context');
      expect(toolNames).toContain('list_directory');
      expect(toolNames).toContain('grep_search');

      for (const t of openAiTools) {
        expect(t.type).toBe('function');
        expect(t.function.description).toBeDefined();
        expect(t.function.parameters).toBeDefined();
        expect(t.function.parameters['type']).toBe('object');
      }
    });

    it('formats specific subset of tools when requested', () => {
      const subset = formatToolsForOpenAi(['read_file', 'edit_file']);
      expect(subset.length).toBe(2);
      expect(subset.map((s) => s.function.name)).toEqual(['read_file', 'edit_file']);
    });
  });

  describe('formatToolsForReActPrompt', () => {
    it('produces structured textual manual with parameter details', () => {
      const manual = formatToolsForReActPrompt();

      expect(manual).toContain('**read_file**');
      expect(manual).toContain('**edit_file**');
      expect(manual).toContain('- path (string, required)');
      expect(manual).toContain('- old_str (string, required)');
      expect(manual).toContain('- new_str (string, required)');
    });
  });

  describe('PromptBuilder', () => {
    const sampleTask: AgentTask = {
      taskId: 'django__django-11001',
      repo: 'django/django',
      problemStatement: 'Fix SQL ordering issue in django/db/models/sql/compiler.py',
    };

    const sampleSubtask: SubTask = {
      id: 'subtask_1',
      stepIndex: 1,
      type: 'localize',
      goal: 'Identify line in compiler.py where ordering is computed',
      targetFiles: ['django/db/models/sql/compiler.py'],
      estimatedTokens: 1000,
      status: 'pending',
      retryCount: 0,
    };

    it('builds system prompt with ReAct guidelines and tool manual', () => {
      const builder = new PromptBuilder();
      const sysPrompt = builder.buildSystemPrompt();

      expect(sysPrompt).toContain('autonomous Software Engineering Agent');
      expect(sysPrompt).toContain('Thought');
      expect(sysPrompt).toContain('Action');
      expect(sysPrompt).toContain('Action Input');
      expect(sysPrompt).toContain('Final Answer');
      expect(sysPrompt).toContain('**read_file**');
      expect(sysPrompt).toContain('**edit_file**');
    });

    it('builds active subtask prompt with task info, goal, and target files', () => {
      const builder = new PromptBuilder();
      const subtaskPrompt = builder.buildSubtaskPrompt(sampleTask, sampleSubtask);

      expect(subtaskPrompt).toContain('django/django');
      expect(subtaskPrompt).toContain('Fix SQL ordering issue');
      expect(subtaskPrompt).toContain('Identify line in compiler.py');
      expect(subtaskPrompt).toContain('django/db/models/sql/compiler.py');
    });

    it('includes previous failure error message when subtask has failed previously', () => {
      const builder = new PromptBuilder();
      const failedSubtask: SubTask = {
        ...sampleSubtask,
        retryCount: 1,
        lastError: 'Target string not found in compiler.py',
      };

      const prompt = builder.buildSubtaskPrompt(sampleTask, failedSubtask);
      expect(prompt).toContain('Previous Attempt Failed with Error:');
      expect(prompt).toContain('Target string not found in compiler.py');
    });
  });
});
