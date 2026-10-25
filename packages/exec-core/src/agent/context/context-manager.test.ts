import { describe, it, expect } from 'vitest';
import { stripAnsi, compactToolOutput } from './output-compactor.js';
import {
  ConversationHistory,
  estimateTokens,
  TIER_CONTEXT_BUDGETS,
} from './conversation-history.js';

describe('Context Management & Output Compaction', () => {
  describe('stripAnsi', () => {
    it('removes ANSI color and style escape codes', () => {
      const styled = '\u001b[31mError:\u001b[0m \u001b[1mFile not found\u001b[0m';
      expect(stripAnsi(styled)).toBe('Error: File not found');
    });
  });

  describe('compactToolOutput', () => {
    it('leaves short outputs under limit untouched', () => {
      const short = 'Line 1\nLine 2\nLine 3';
      const result = compactToolOutput(short, 'run_command');
      expect(result).toBe(short);
    });

    it('never compacts read_file output regardless of length', () => {
      const lines = Array.from({ length: 300 }, (_, i) => `${i + 1} | const x = ${i};`).join('\n');
      const result = compactToolOutput(lines, 'read_file');
      expect(result).toBe(lines);
      expect(result).not.toContain('Output truncated');
    });

    it('compacts large terminal outputs and retains head and tail with actionable notice', () => {
      const lines = Array.from({ length: 200 }, (_, i) => `Output line ${i + 1}`);
      const raw = lines.join('\n');

      const result = compactToolOutput(raw, 'run_command', {
        maxLines: 100,
        headLines: 10,
        tailLines: 10,
      });

      expect(result).toContain('Output line 1');
      expect(result).toContain('Output line 10');
      expect(result).toContain('Output line 191');
      expect(result).toContain('Output line 200');
      expect(result).toContain('Output truncated: 180 lines omitted');
      expect(result).toContain("use 'read_file' with offset & limit");
    });
  });

  describe('ConversationHistory', () => {
    it('calibrates budgets to 8k for SLM and 32k for LLM', () => {
      const slmHistory = new ConversationHistory('slm');
      const llmHistory = new ConversationHistory('llm');

      expect(TIER_CONTEXT_BUDGETS.slm.maxTotalTokens).toBe(8192);
      expect(TIER_CONTEXT_BUDGETS.llm.maxTotalTokens).toBe(32768);

      expect(slmHistory.getAvailableInputBudget()).toBe(8192 - 1024);
      expect(llmHistory.getAvailableInputBudget()).toBe(32768 - 4096);
    });

    it('estimates tokens reliably based on character heuristics', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('a'.repeat(400))).toBe(100);
    });

    it('preserves system prompt and initial user task when pruning flexible turns', () => {
      // Create a small budget history for testing compaction
      const history = new ConversationHistory('slm', {
        maxTotalTokens: 300,
        reservedOutputTokens: 50,
      }); // Input budget = 250 tokens (~1000 chars)

      history.addMessage('system', 'You are an SE agent.');
      history.addMessage('user', 'Initial problem: Fix bug in auth.py');

      // Add 10 bulky intermediate turns (~200 chars each = ~50 tokens each)
      for (let i = 1; i <= 10; i++) {
        history.addMessage('assistant', `Thought: inspecting step ${i}. ${'x'.repeat(150)}`);
        history.addMessage('user', `Observation: result ${i}. ${'y'.repeat(150)}`);
      }

      const compacted = history.getCompactedMessages();

      // Pinned messages must always be present
      expect(compacted[0]?.role).toBe('system');
      expect(compacted[0]?.content).toBe('You are an SE agent.');

      expect(compacted[1]?.role).toBe('user');
      expect(compacted[1]?.content).toBe('Initial problem: Fix bug in auth.py');

      // Must contain continuity notice
      const noticeMsg = compacted.find((m) =>
        m.content.includes('earlier tool interaction turns were summarized/compacted'),
      );
      expect(noticeMsg).toBeDefined();

      // Most recent turn must be kept
      const lastMsg = compacted[compacted.length - 1];
      expect(lastMsg?.content).toContain('result 10');

      // Total tokens of compacted messages must strictly fit input budget
      const totalEstimated = compacted.reduce((acc, m) => acc + estimateTokens(m.content), 0);
      expect(totalEstimated).toBeLessThanOrEqual(250);
    });

    it('prunes older bulky tool observations while preserving recent observations and model thoughts', () => {
      const history = new ConversationHistory('slm', {
        maxTotalTokens: 10000,
        reservedOutputTokens: 1000,
      });

      history.addMessage('system', 'System prompt');
      history.addMessage('user', 'Task prompt');

      // Turn 1: Bulky file reading observation
      history.addMessage(
        'assistant',
        'Thought: Reading files to inspect structure.\nAction: read_file',
      );
      const bulkyFileContent = Array.from(
        { length: 50 },
        (_, i) => `=== File: src/file${i}.ts ===\nconst x = ${i};`,
      ).join('\n');
      history.addMessage('user', `Observation: ${bulkyFileContent}`);

      // Turn 2: Model deduced findings, wrote code
      history.addMessage(
        'assistant',
        'Thought: I understand the structure. Now writing files.\nAction: write_file',
      );
      history.addMessage('user', 'Observation: Successfully wrote 2 files.');

      // Turn 3: Model is deciding next step
      const messagesBeforeCompaction = history.getMessages();
      expect(messagesBeforeCompaction[3]?.content.length).toBeGreaterThan(500);

      const compacted = history.getCompactedMessages();
      // Turn 1's observation should now be pruned to a concise receipt
      expect(compacted[3]?.content).toContain('[Inspected 50 file(s)');
      expect(compacted[3]?.content.length).toBeLessThan(1500);

      // Turn 2's recent observation and Turn 2's thought must be preserved
      expect(compacted[4]?.content).toContain('Now writing files');
      expect(compacted[5]?.content).toBe('Observation: Successfully wrote 2 files.');
    });
  });
});
