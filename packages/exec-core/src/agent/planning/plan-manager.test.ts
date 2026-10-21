import { describe, it, expect } from 'vitest';
import { PlanSpanAttributesSchema } from '@soa/contracts';
import { PlanGenerator } from './plan-generator.js';
import { PlanManager } from './plan-manager.js';
import { AgentTask } from '../types.js';
import { ModelSelector } from '../../routing/model-selector.js';

describe('PlanGenerator and PlanManager', () => {
  const sampleTask: AgentTask = {
    taskId: 'django__django-11001',
    repo: 'django/django',
    problemStatement:
      'Incorrect SQL ordering when RawSQL is used in order_by in django/db/models/sql/compiler.py and tests/test_compiler.py',
  };

  describe('PlanGenerator', () => {
    it('generates deterministic subtask plan with routing features', async () => {
      const generator = new PlanGenerator();
      const subtasks = await generator.generatePlan(sampleTask);

      expect(subtasks.length).toBe(5); // explore, localize, edit_multi_file, test, plan

      // Verify sequence of types
      expect(subtasks[0]?.type).toBe('explore');
      expect(subtasks[1]?.type).toBe('localize');
      expect(subtasks[2]?.type).toBe('edit_multi_file');
      expect(subtasks[3]?.type).toBe('test');
      expect(subtasks[4]?.type).toBe('plan');

      // Verify extracted target files
      expect(subtasks[0]?.targetFiles).toContain('django/db/models/sql/compiler.py');
      expect(subtasks[0]?.targetFiles).toContain('tests/test_compiler.py');

      // Verify routing features attached
      for (const st of subtasks) {
        expect(st.features).toBeDefined();
        expect(st.features?.step_type).toBe(st.type);
      }
    });

    it('routes subtasks to SLM and LLM tiers using ModelSelector', async () => {
      const generator = new PlanGenerator();
      const subtasks = await generator.generatePlan(sampleTask);
      const selector = new ModelSelector();

      // Check model selector decisions on generated subtasks
      const decisions = subtasks.map((st) => ({
        type: st.type,
        decision: selector.selectTier(st.features!),
      }));

      // Explore and test execution qualify for SLM tier
      const exploreDec = decisions.find((d) => d.type === 'explore');
      expect(exploreDec?.decision.tier).toBe('slm');

      // Complex multi-file code edit escalates to LLM tier
      const editDec = decisions.find((d) => d.type === 'edit_multi_file');
      expect(editDec?.decision.tier).toBe('llm');
    });

    it('respects verify_after_edit: false in planning config', async () => {
      const generator = new PlanGenerator({ config: { verify_after_edit: false } });
      const subtasks = await generator.generatePlan(sampleTask);

      expect(subtasks.length).toBe(4);
      expect(subtasks.some((s) => s.id.includes('verify'))).toBe(false);
    });

    it('supports custom decomposer override', async () => {
      const generator = new PlanGenerator({
        customDecomposer: (task) => [
          {
            id: 'custom_1',
            stepIndex: 0,
            type: 'edit_single_file',
            goal: `Quick patch for ${task.taskId}`,
            targetFiles: ['patch.py'],
            estimatedTokens: 500,
            status: 'pending',
            retryCount: 0,
          },
        ],
      });

      const subtasks = await generator.generatePlan(sampleTask);
      expect(subtasks.length).toBe(1);
      expect(subtasks[0]?.id).toBe('custom_1');
    });
  });

  describe('PlanManager', () => {
    it('manages sequential plan advancement and completion', async () => {
      const generator = new PlanGenerator();
      const subtasks = await generator.generatePlan(sampleTask);
      const manager = new PlanManager(sampleTask.taskId, subtasks);

      expect(manager.isCompleted()).toBe(false);
      expect(manager.getActiveSubtask()?.stepIndex).toBe(0);
      expect(manager.getActiveSubtask()?.status).toBe('in_progress');

      // Complete all steps one by one
      while (!manager.isCompleted()) {
        const completed = manager.markActiveCompleted();
        expect(completed?.status).toBe('completed');
      }

      expect(manager.isCompleted()).toBe(true);
      expect(manager.getProgress().completed).toBe(subtasks.length);
      expect(manager.getProgress().failed).toBe(0);
    });

    it('emits valid PlanSpanAttributes adhering to @soa/contracts', async () => {
      const generator = new PlanGenerator();
      const subtasks = await generator.generatePlan(sampleTask);
      const manager = new PlanManager(sampleTask.taskId, subtasks);

      // Initial state
      const initialAttrs = manager.getPlanSpanAttributes();
      expect(PlanSpanAttributesSchema.safeParse(initialAttrs).success).toBe(true);
      expect(initialAttrs.step_index).toBe(0);
      expect(initialAttrs.replan_reason).toBeNull();

      manager.markActiveCompleted();

      // Step 1
      const step1Attrs = manager.getPlanSpanAttributes();
      expect(step1Attrs.step_index).toBe(1);
    });

    it('handles failure, retries, and backtracking within backtrack_depth', async () => {
      const generator = new PlanGenerator({ config: { backtrack_depth: 2 } });
      const subtasks = await generator.generatePlan(sampleTask);
      const manager = new PlanManager(sampleTask.taskId, subtasks, { backtrack_depth: 2 });

      // Step 0 -> Complete
      manager.markActiveCompleted();
      expect(manager.getActiveStepIndex()).toBe(1);

      // Step 1 -> Complete
      manager.markActiveCompleted();
      expect(manager.getActiveStepIndex()).toBe(2);

      // Step 2 -> Fails
      manager.markActiveFailed('Syntax error in compiler.py');
      const failedSubtask = manager.getActiveSubtask();
      expect(failedSubtask?.status).toBe('failed');
      expect(failedSubtask?.lastError).toContain('Syntax error');
      expect(failedSubtask?.retryCount).toBe(1);

      // Can backtrack to Step 1
      expect(manager.canBacktrack()).toBe(true);
      const rolledBack = manager.backtrack('Need to re-analyze compiler.py syntax');

      expect(rolledBack?.stepIndex).toBe(1);
      expect(rolledBack?.status).toBe('in_progress');
      expect(manager.getState().replanCount).toBe(1);
      expect(manager.getState().replanReason).toBe('Need to re-analyze compiler.py syntax');

      // Span attributes include replan_reason
      const spanAttrs = manager.getPlanSpanAttributes();
      expect(spanAttrs.step_index).toBe(1);
      expect(spanAttrs.replan_reason).toBe('Need to re-analyze compiler.py syntax');
    });

    it('supports dynamic replanning of remaining subtasks', async () => {
      const generator = new PlanGenerator();
      const subtasks = await generator.generatePlan(sampleTask);
      const manager = new PlanManager(sampleTask.taskId, subtasks);

      // Complete step 0
      manager.markActiveCompleted();
      expect(manager.getActiveStepIndex()).toBe(1);

      // Dynamic replan for remaining steps
      manager.replan(
        [
          {
            id: 'emergency_patch_step',
            stepIndex: 1,
            type: 'edit_single_file',
            goal: 'Direct targeted hotfix',
            targetFiles: ['django/db/models/sql/compiler.py'],
            estimatedTokens: 1000,
            status: 'pending',
            retryCount: 0,
          },
        ],
        'Replaced analysis with hotfix due to critical bug',
      );

      const state = manager.getState();
      expect(state.subtasks.length).toBe(2); // Retained step 0 + 1 new step
      expect(state.replanCount).toBe(1);
      expect(state.replanReason).toBe('Replaced analysis with hotfix due to critical bug');
      expect(manager.getActiveSubtask()?.id).toBe('emergency_patch_step');
    });
  });
});
